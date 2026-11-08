# 01 · 设计目标与技术约束

> 本文档描述 `mini-three-adapter` 自身的设计目标、运行环境约束、技术选型与能力边界。它是阅读 [02 架构设计](./02-architecture.md) 之前的总纲。

## 1.1 项目定位

`mini-three-adapter` 让 three.js 运行在微信小游戏 / 小程序的**非 WebView 原生渲染环境**中，目标是让业务侧的场景代码尽可能保持标准 three.js 写法：

- 用 `new THREE.WebGLRenderer({ canvas })` 创建渲染器，不改写 three 源码、不引入定制版 three。
- 用 `three/addons/*` 的控制器、加载器，交互行为与浏览器一致。
- 同一份场景代码可以在小游戏、小程序和 H5 双端运行。
- 适配层本身不参与渲染管线、不管理材质与资源生命周期，这些仍归 three 与业务代码。

## 1.2 运行环境约束

微信小游戏的 JavaScript 运行时在 iOS 是 JavaScriptCore、Android 是 V8，**没有 BOM 与 DOM**：不存在全局 `window`、`document`、`Image`、`URL`、`XMLHttpRequest`、`EventTarget`。基础库只提供 `wx.*` 平台 API 与 `setTimeout` / `requestAnimationFrame` 等基础方法；DOM 兼容层需要由应用自行引入。

由此派生出几条硬约束：

| 约束 | 对实现的要求 |
| --- | --- |
| 只有一个上屏画布：首次 `wx.createCanvas()` 得到上屏画布，后续调用得到的都是离屏画布 | 必须把这一次调用收敛到单一位置并缓存；能力探测只能用 `wx.createOffscreenCanvas()` |
| 宿主内部按对象身份保存画布校验数据 | 画布补丁必须作用于原对象，不能包装、克隆或改原型 |
| `Canvas.getContext('webgl2')` 是可用的标准 WebGL2 上下文 | three ≥ r163 仅支持 WebGL2，适配层以 WebGL2 为唯一主线 |
| Worker 并发上限为 1，且配置只支持一个目录 | worker 与 wasm 必须输出到同一目录，分包 Worker 需先预下载 |
| 代码包有体积上限（主包 / 分包各 4MB、总包 8MB，以控制台额度为准） | three 本体、decoder、wasm 需要分包；`.wasm.br` 是有效的减包手段 |
| iOS 高性能模式内存限制更严，高性能+ 建议用于 WebGL2 场景 | 启动阶段就要能报告能力、避免不必要的大对象常驻 |

小程序（非小游戏）额外约束：画布节点要通过 `createSelectorQuery().select(...).fields({ node, rect, size })` **异步**取得，触摸事件由 WXML 绑定下发，而不是 `wx.onTouch*`。

## 1.3 Three.js 版本约束

| 版本 | 关系 |
| --- | --- |
| `>= 0.163.0`（r163+） | 目标区间。`WebGLRenderer` 要求 WebGL2 |
| `0.187.0` | 当前构建与单元测试所依据的版本 |
| `0.151.0 ~ 0.162.x` | 不保证：未针对 WebGL1 路径做专门适配 |
| `< 0.151.0` | 不提供保证 |
| `three/webgpu` + TSL / NodeMaterial | 小游戏环境没有 WebGPU，构建插件默认告警；复杂 WebGPU 项目需使用 WebGL 构建目标 |

版本升级时需要复核：导入路径（`three/addons/*`）、`renderer.outputColorSpace`、`renderer.setAnimationLoop()`、以及 three 新增的浏览器全局与 DOM 属性清单。检查项固化在 [`docs/11-compat-matrix.md`](./11-compat-matrix.md)。

## 1.4 设计目标

1. **不 fork three**：构建期只重定向三方模块对浏览器全局的自由引用，不修改 three 的语义。适配层与 three 版本解耦。
2. **零全局污染**：所有 shim 存放在显式的 `MiniThreeScope` 中，可被替换、可被卸载；写 `globalThis` 只发生在显式调用且可逆的路径上。
3. **一套 API 覆盖三端**：`createRuntime()` 返回唯一的 `MiniThreeRuntime`，平台差异收敛在 `PlatformBinding` 内部。
4. **单一生命周期**：所有订阅、定时器、全局注入统一登记，`dispose()` 之后不留副作用。
5. **可测试**：平台宿主可注入，核心逻辑能在 Node + Vitest 中完整验证，无需真实设备。
6. **可观测**：分级日志、一次性告警、能力报告与构建报告，让环境问题在启动/构建阶段就能定位。
7. **可 tree-shake**：ESM + 子路径导出 + 显式 `sideEffects`，运行时不携带构建工具依赖。

## 1.5 技术选型

| 领域 | 选型 | 理由 |
| --- | --- | --- |
| 语言与模块 | TypeScript strict + ESM | 完整 `.d.ts`，编译期捕获平台类型差异 |
| 运行时构建目标 | `es2019`（esbuild / tsup） | 降级可选链与空值合并，避免开发者工具语法报错 |
| 全局重定向 | `@babel/parser` + `@babel/traverse` + `magic-string` | 依赖真实作用域绑定信息，只改写自由变量，保留 sourcemap |
| 画布兼容 | `Object.defineProperty` + `Symbol.hasInstance` 注册表 | 保持对象身份，满足 three 的 `instanceof` 分支 |
| 平台抽象 | 结构化接口 `PlatformBinding` | 以组合方式表达平台差异，新增平台只需实现一组字段与方法 |
| 作用域 | `getActiveScope()` 惰性读取 | 支持运行时替换、多实例与测试注入 |
| 网络 | `wx.request` 桥接 `fetch` / `XMLHttpRequest` | three 的 FileLoader 与 addons 可直接工作 |
| 对象 URL | `mini-three-blob:` → `data:` URI | 宿主图片加载器可直接识别，无需拦截 `Image.src` |
| 构建工具集成 | Rollup 兼容插件核心 + Vite 薄封装 | 一套逻辑覆盖 Vite / Rollup，Node 依赖不进小游戏包 |

## 1.6 能力边界

**做**：

- 补全 three 与主流生态（three-stdlib / @react-three / @tresjs）用到的浏览器全局、DOM 属性与构造器判定。
- 把平台 `touch` 事件转换为符合 three controls 预期的 `pointer*` / `mouse*` 事件。
- 统一窗口尺寸、DPR、resize、可见性、帧循环。
- 构建期收集 worker / wasm / decoder 资源并生成分包建议。
- 提供 H5 双端可运行的 `browser` 平台。

**不做**：

- 不提供完整 DOM / CSS 布局 / 事件冒泡树；DOM 密集型 UI 应使用 WebView 方案。
- 不模拟 WebGPU；`createImageBitmap`、`FileReader`、`WebSocket` 保持 `undefined`，让依赖它们的库走降级分支。
- 不在运行时改写 `WebGLRenderer` 的行为；平台差异补丁一律显式、可关闭、可观测。
- 不默认改写业务代码（插件只处理 `node_modules` 中的三方生态模块）。
- 不内置物理、动画、UI 等 3D 引擎能力。

## 1.7 关键设计决策一览

| 决策 | 落地位置 | 详情 |
| --- | --- | --- |
| 显式可逆作用域 | `src/scope.ts` | [ADR-0001](./adr/0001-scoped-globals.md) |
| 单一运行生命周期 | `src/core/runtime.ts` | [ADR-0002](./adr/0002-unified-runtime-lifecycle.md) |
| AST 作用域重写 | `src/build/scope-rewrite.ts` | [ADR-0003](./adr/0003-ast-rewrite.md) |
| 就地画布补丁 | `src/core/element.ts` | [ADR-0004](./adr/0004-in-place-patching.md) |
| WebGL2 优先 | `src/core/capabilities.ts` | [ADR-0005](./adr/0005-webgl2-only.md) |
| 零 three 依赖、构建运行隔离 | `tsup.config.ts` | [ADR-0006](./adr/0006-zero-three-dependency.md) |

## 1.8 规范链接

平台与渲染引擎的权威规范，用于核对能力边界：

- [微信开放文档 · Adapter](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)
- [微信开放文档 · 渲染](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/render.html)
- [微信开放文档 · 使用 WXWebAssembly](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html)
- [微信开放文档 · iOS 高性能与高性能+模式](https://developers.weixin.qq.com/minigame/dev/guide/game-engine/unity-webgl-transform/Design/iOSOptimization.html)
- 微信开放文档 · 小游戏配置（game.json 的 workers / subpackages / iOSHighPerformance 字段）
- [three.js Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
