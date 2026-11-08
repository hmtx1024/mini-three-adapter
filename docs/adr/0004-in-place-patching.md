# ADR-0004 · 就地 patch 画布，不改原型、不用 Proxy

- 状态：Accepted
- 日期：2026-11-08
- 影响模块：`src/core/element.ts`、`src/core/canvas.ts`、`src/core/image.ts`、`src/core/dom.ts`

## 背景

宿主内部按对象身份保存画布与图片的校验数据，任何「新建一个类实例包装」「用 Proxy 拦截」「克隆对象」的做法都会让这些校验失效。因此 three 需要的 DOM 属性与方法必须直接补到宿主返回的那个对象上。

同时，three 与 addons 会用 `instanceof HTMLCanvasElement` 之类的判定选择代码分支，补丁还需要让这些判定成立。修改对象原型虽然能达到目的，但在 JSC/V8 上是明确的去优化操作，且会与其他库对原型的修改互相覆盖。

## 决策

1. **保持对象身份**：所有补丁都是对 `wx` 返回的那个对象执行 `Object.defineProperty`。
2. **禁止** `new Proxy(...)` 包装、禁止克隆对象、禁止 `Object.setPrototypeOf`。
3. `instanceof` 用 `createMockClass()` 生成的 `Symbol.hasInstance` + `WeakSet` 注册表实现，补丁时把对象注册进对应的 shim。
4. 需要 `new SomeCtor()` 的场景（如 `OffscreenCanvas`）提供真正返回平台对象的构造器函数。
5. `style.width/height`、`clientWidth/Height`、`getBoundingClientRect()` 用闭包 `rect` 的响应式 getter，`updateRect()` 一处更新全处生效。

## 理由

- 宿主校验依赖对象身份；任何包装都会破坏它。
- `Object.setPrototypeOf` 是去优化操作，而且会与其他补丁冲突。
- `Symbol.hasInstance` 是标准机制，精确且零副作用；`WeakSet` 不阻止 GC。

## 后果

- 正面：兼容宿主校验、性能更好、可与其他补丁共存；身份不变也让缓存/Map 键稳定。
- 负面：每个新 DOM 属性都要显式补；three 升级时可能发现新的属性缺失（这是 `docs/11` 升级检查项）。
- 负面：`instanceof` 只对注册过的对象成立；业务自己 `new` 出来的假对象不会被识别（可接受）。
- 风险：`defineProperty` 可能遇到宿主不可配置属性 → `normalizeContext()` 里对 `ctx.canvas` 的赋值用 try/catch 保护。

## 被否决的备选方案

- 继承/代理包装：破坏身份，否决。
- 改原型：去优化 + 冲突风险，否决。
- 只靠 `Object.defineProperty` 不做 `instanceof`：three 与 addons 会用 `instanceof HTMLCanvasElement` 分支，否决。

## 验证方式

`tests/runtime.test.ts`：「patches the canvas in place」「caches WebGL2 context identity and satisfies instanceof」断言 `runtime.canvas === wx.__canvases[0]` 且 `instanceof` 成立。
