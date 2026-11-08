# 08 · 扩展指南

> 面向人和 AI：三种最常见的扩展（新平台 / 新 polyfill / 新资源规则）各自的最小改动集与验收标准。

## 8.1 新增一个平台

**原则**：平台差异只允许出现在 `src/platforms/`。`core/` 不认识任何平台。

1. 在 `src/platforms/<name>.ts` 实现 `PlatformBinding`（`src/core/platform.ts`）。
2. 复用 `wechat-common.ts` 里能复用的部分；若新平台 API 差异大，就在 `wx-types.ts` 里补结构化类型或新建 `<name>-types.ts`。
3. 导出 `create<Name>Binding()` 与 `create<Name>Runtime()`（后者调用 `createRuntime(() => binding, options)`）。
4. 在 `src/index.ts` 导出；在 `package.json` 的 `exports` 加子路径。
5. 在 `Capabilities['platform']`（`src/types.ts`）加字面量；在 `docs/11-compat-matrix.md` 登记。
6. 补 `tests/<name>.test.ts`，用 mock 宿主验证：画布补丁、scope、触摸、resize、dispose。
7. 加 `examples/<name>/` 最小可运行示例。

模板：

```ts
import type { PlatformBinding } from '../core/platform';
import { createRuntime, type MiniThreeRuntime, type RuntimeOptions } from '../core/runtime';
import { detectCapabilities } from '../core/capabilities';

export function createFooBinding(options: FooOptions): PlatformBinding {
  const host = resolveFoo(options.host);
  return {
    kind: 'browser', // 或扩展 Capabilities['platform'] 字面量
    wx: undefined,
    rawCanvas: host.canvas,
    capabilities: detectCapabilities(host.wxLike, 'browser'),
    imageFactory: createImageFactory(host.wxLike),
    getCanvasRect: () => host.rect(),
    createOffscreenCanvas: (w, h, type) => host.offscreen(w, h, type),
    watchTouch: (handler) => host.onTouch(handler),
    watchVisibility: (handler) => host.onVisibility(handler),
    requestAnimationFrame: (cb) => host.raf(cb),
    cancelAnimationFrame: (id) => host.caf(id),
    now: () => host.now(),
    dispose: () => host.close(),
  };
}

export function createFooRuntime(options: FooOptions & RuntimeOptions = {}): Promise<MiniThreeRuntime> {
  return createRuntime(() => createFooBinding(options), options);
}
```

**验收**：`npm run check` 通过；`dispose()` 后所有监听被移除；`getCanvasRect()` 在尺寸变化后能通过 `runtime.resize()` 生效；不得调用 `wx.createCanvas()` 超过一次。

## 8.2 新增一个 polyfill / 全局 shim

three 报 `X is not defined` 或 `X is not a constructor` 时，按以下顺序改：

1. `src/polyfills/` 新建实现文件（自包含，不 import `core/*`）。
2. 在 `src/polyfills/index.ts` 导出。
3. 在 `src/scope.ts` 的 `MiniThreeScope` 接口里加字段，并加入 `GLOBAL_KEYS`（这样 `installGlobals()` 也会带上它）。
4. 在 `src/core/runtime.ts` 的 scope 组装区赋值（或按平台条件赋值）。
5. 在 `src/build/scope-rewrite.ts` 的 `DEFAULT_GLOBAL_NAMES` 加入标识符。
6. 补测试：`tests/polyfills.test.ts`（实现）+ `tests/scope-rewrite.test.ts`（改写）+ `tests/runtime.test.ts`（scope 中存在）。
7. 更新 `docs/04-api-reference.md` 与 `docs/03-module-map.md`。

> 若某个 API 在小程序里**不可用且必须让 three 走降级分支**，把值设为 `undefined` 并加入 `DEFAULT_FORCE_UNDEF`，不要伪造一个半实现（参考 `createImageBitmap`）。

## 8.3 新增 DOM 属性 / `instanceof` 支持

1. `src/core/element.ts` 的 `patchElement()`：加 `define(instance, key, descriptor)`。若需要响应式（随 rect 变化），用闭包 `rect` 的 getter。
2. canvas 专属属性放到 `src/core/canvas.ts` 的 `extra` 描述符里。
3. 若 three 用 `x instanceof SomeCtor` 判断，复用已有 `*Shim`，或 `createMockClass()` 新建一个并在补丁时加入 `instanceOf` 列表。
4. 若 three 用 `new SomeCtor()`，提供一个真正返回平台对象的构造器（参考 `createOffscreenCanvasCtor`）。
5. 补 `tests/runtime.test.ts` 断言。

**禁止**：`Object.setPrototypeOf`、Proxy 包装、返回克隆对象（会破坏微信内部 WeakMap 校验，见 ADR-0004）。

## 8.4 新增资源类型 / override 规则

1. `src/build/assets.ts`：
   - `ASSET_PATTERN` 加入新扩展名；
   - `DECODER_KEYWORDS` 加入新关键字；
   - `defaultRoots()` 加入该库的资源目录；
   - `classify()` 加入新 kind；
   - `decoderPaths` 生成逻辑加入新 key。
2. 若某个 addon 需要替换 import 路径，在 `src/build/plugin-core.ts` 的 `transform` 里加一条**显式、可配置、可关闭**的映射规则，并写进 `docs/05`。不要做成隐式全局替换。
3. 在 `tests/plugin.test.ts` 加资产扫描用例。
4. 更新 `examples/*/vite.config.ts` 的 `roots` 示例与 `docs/05`。

## 8.5 新增构建期能力

- 新 hook 放在 `src/build/plugin-core.ts`；保持 Rollup/Vite 双兼容（只用 `transform` / `resolveId` / `generateBundle` / `config`）。
- 所有新行为都要有对应**开关**与默认值，且默认不得改变已有产物语义。
- 统计信息加入 `BuildReport`，方便 CI 与 AI 读取。
- 参考 ADR 流程：若改变架构不变量，先写 `docs/adr/NNNN-*.md`。

## 8.6 扩展的评审清单

- [ ] 是否违反 [架构不变量](./02-architecture.md#25-架构不变量ai-必读不得破坏)？
- [ ] `src/` 是否引入了 `three` 的运行时 import？
- [ ] 新订阅 / 定时器 / 全局写入是否都登记到 `disposers`？
- [ ] 是否新增了同步 `wx.createCanvas()` 调用？
- [ ] 类型是否 strict 通过（`noUncheckedIndexedAccess`）？
- [ ] 行为是否可被测试（能注入 mock 宿主）？
- [ ] `docs/03`、`docs/04`、`CHANGELOG.md` 是否同步？
