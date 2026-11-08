# ADR-0001 · 作用域化的浏览器环境 shim

- 状态：Accepted
- 日期：2026-11-08
- 影响模块：`src/scope.ts`、`src/core/runtime.ts`、`src/build/scope-rewrite.ts`、`src/build/vite.ts`

## 背景

小游戏运行时没有 DOM/BOM，three 及其 addons 却会读取 `window`、`document`、`Image`、`URL` 等浏览器全局。要让这些代码工作，就必须有一个地方提供这些对象。

如果把 shim 直接挂到 `globalThis`，或者约定一个固定名字的全局容器，会带来几个结构性问题：H5 双端构建会与真实 `window` 冲突；同一进程里无法并存两个独立 runtime；单元测试无法干净还原；全局名靠约定，出错时难以定位。此外，三方模块中的全局引用是在模块求值时发生的，作用域何时可用必须是可以推理的，而不能依赖 import 的隐式副作用。

## 决策

1. 所有 shim 只存在于一个显式的 `MiniThreeScope` 对象里，`window === self === globalThis === scope`。
2. `setActiveScope(scope)` 返回 disposer；`getActiveScope()` 供构建插件注入的 `__m3()` 使用，且每次访问都返回**当前**作用域，支持运行时替换。
3. 三方模块通过构建插件改写为 `__m3().window`；应用代码不受影响。
4. `installGlobals(scope)` 是**唯一**写 `globalThis` 的地方，必须显式调用、返回精确还原 descriptor 的 disposer，默认关闭。
5. 未创建 runtime 时 `getActiveScope()` 返回一个占位对象：`typeof x.window` 仍为 `'object'`（满足 three 特性检测），但真正取属性时抛出带指引的错误。

## 理由

- 可逆性让测试、热更新、多实例、H5 双端都成为可能。
- 显式生命周期让「作用域何时可用」成为可推理的问题。
- 惰性读取让作用域可以在不重新构建三方模块的前提下被替换。

## 后果

- 正面：H5 双端同源、可 `dispose()`、可注入 mock、可观测。
- 负面：**必须先创建 runtime 再让 three 模块求值**，因此入口必须用动态 `import('./scene.js')`；这是一个需要写进文档与示例的约束（见 `docs/06` §6.2）。
- 风险：若某个三方库在模块顶层就把 `window.innerWidth` 缓存下来，动态 import 顺序错误会得到占位值——占位作用域会抛明确错误而不是静默返回错误值。

## 被否决的备选方案

- 直接 `globalThis.window = ...`：简单但不可逆，否决。
- 每个 runtime 一个 Proxy 拦截全局：性能与兼容性（JSC）风险，且仍要写全局，否决。
- 让用户在业务代码里手动 `import { scope }`：侵入太大，三方库改不到，否决。

## 验证方式

`tests/runtime.test.ts`：「populates a scoped environment without polluting globalThis」「installGlobals is reversible」；`tests/scope-rewrite.test.ts`：注入的 import 与 `typeof` 行为。
