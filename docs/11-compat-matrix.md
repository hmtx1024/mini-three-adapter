# 11 · 兼容矩阵

> 状态说明：✅ 已验证 / 🟡 理论支持或单元测试覆盖，待真机 / ⚠️ 有限制 / ❌ 不支持。
> 每次发布前更新；真机验收清单见 [`docs/09`](./09-testing-and-release.md#97-真机验收清单发布前)。

## 11.1 three.js 版本

| three 版本 | 状态 | 说明 |
| --- | --- | --- |
| `>= 0.163.0`（r163+） | ✅ 目标区间 | r163 起 `WebGLRenderer` 要求 WebGL2，与本适配层默认一致 |
| `0.187.0` | 🟡 单元级 | 2026-11-08 npm 最新版；已按 Migration Guide 检查 `three/addons`、`outputColorSpace`、`setAnimationLoop`；待真机全量回归 |
| `0.151.0 ~ 0.162.x` | ⚠️ | 未针对 WebGL1 路径做专门适配，建议升级到 r163+ |
| `< 0.151.0` | ❌ | 不提供保证 |
| `three/webgpu` + TSL / NodeMaterial | ❌ | 小游戏无 WebGPU；插件默认告警，可选 `webgpu:'rewrite'` 仅适用于纯 WebGLRenderer 的简单场景 |

### 每次 three 升级需要复核的点

1. `DEFAULT_GLOBAL_NAMES`（`src/build/scope-rewrite.ts`）是否覆盖新增浏览器全局。
2. `patchElement` / `patchCanvas`（`src/core/element.ts`、`canvas.ts`）是否覆盖新增 DOM 属性。
3. import 路径：`three/addons/*` 与旧 `three/examples/jsm/*` 都要在插件 include 规则里。
4. `RGBELoader → HDRLoader`、`EffectComposer → PostProcessing` 等破坏性改名（r180+）。
5. `three/webgpu` 使用比例上升时，插件 `webgpu` 默认策略是否需要调整。
6. 用 `examples/` 的三个平台工程对 controls / loaders / postprocessing 类别做增量回归。

## 11.2 微信基础库 / 平台

| 能力 | 最低基础库 | 状态 | 依据 / 处理 |
| --- | --- | --- | --- |
| `wx.createCanvas` / `getContext('webgl2')` | — | ✅ | [渲染文档](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/render.html) |
| 唯一上屏画布规则 | — | ✅ | `getScreenCanvas()` 单次缓存 |
| `wx.createOffscreenCanvas` | 2.7.0（小程序）/ 小游戏同期 | ✅ | 能力探测与离屏画布；不可用时明确报错 |
| `wx.getWindowInfo` | 较新版本 | ✅ | 回退 `getSystemInfoSync` |
| `wx.onWindowResize` | — | 🟡 | 不可用时告警，需手动 `runtime.resize()` |
| `WXWebAssembly` | 2.13.0（Worker 内 2.15.0） | 🟡 | [官方文档](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html)；插件按引用拷贝 wasm |
| `.wasm.br` Brotli | — | 🟡 | `assets.brotli: true` |
| Worker（分包） | 2.0.10 | 🟡 | 需 `wx.preDownloadSubpackage({packageType:'workers'})`；并发上限 1 |
| 分包加载 | 2.1.0 | 🟡 | `game.json` 建议由 manifest 生成 |
| iOS 高性能 / 高性能+ | 需后台开通 | 🟡 | `game.json` 的 `iOSHighPerformance` / `iOSHighPerformance+`；官方建议 WebGL2 场景开启高性能+ |
| `wx.triggerGC` | — | ✅ | 影响 image 创建路径判定 |

## 11.3 平台支持

| 平台 | 入口 | 状态 | 备注 |
| --- | --- | --- | --- |
| 微信小游戏 | `mini-three-adapter/wechat-game` | ✅ 单元级 | 自动订阅 `wx.onTouch*`；完整示例 |
| 微信小程序（`<canvas type="webgl2">`） | `mini-three-adapter/wechat-miniprogram` | 🟡 | 需 WXML 转发 `bindtouch*`；`selectorCtx` 传组件实例 |
| 浏览器 / H5 双端 | `mini-three-adapter/browser` | ✅ 单元级 | 真实 DOM 不被覆盖；可跑 Node 测试 |
| 其他小程序 / 小游戏平台 | 自定义 `PlatformBinding` | 🟡 框架就绪 | 按 [`docs/08`](./08-extension-guide.md#81-新增一个平台) 实现 |
| WebView 套壳 | 不在范围内 | ❌ | 本方案用于非 WebView 原生渲染 |

## 11.4 Web / DOM API 覆盖

| API | 提供方式 | 状态 |
| --- | --- | --- |
| `window` / `self` / `globalThis`（作用域内） | `MiniThreeScope` 自引用 | ✅ |
| `document.createElement('canvas' \| 'img')` | `createDocument` | ✅ |
| `document.createElementNS` / `body` / `visibilityState` | `createDocument` | ✅ |
| `HTMLCanvasElement` / `HTMLImageElement` / `HTMLElement` / `OffscreenCanvas` / `ImageData` / `DOMRect` 的 `instanceof` | `Symbol.hasInstance` 注册表 | ✅ |
| `Event` / `EventTarget` / `CustomEvent` / `PointerEvent` / `MouseEvent` / `MessageEvent` / `ProgressEvent` | `polyfills/event.ts` | ✅ |
| `Blob` / `URL.createObjectURL` / `URL.revokeObjectURL` | `mini-three-blob:` → `data:` | ✅ |
| `URL` 构造 / 相对路径解析 | `MiniURL` | ✅ |
| `TextEncoder` / `TextDecoder` / `atob` / `btoa` | `polyfills/text-encoding.ts` | ✅ |
| `fetch` / `XMLHttpRequest` / `AbortController` | `wx.request` 桥接 | 🟡 单元级，真机网络待验证 |
| `requestAnimationFrame` / `cancelAnimationFrame` | `FrameScheduler` | ✅ |
| `performance.now` | `wx.getPerformance` → `Date.now` 回退 | ✅ |
| `getComputedStyle` / `matchMedia` / `screen` / `navigator` | 轻量模拟 | ⚠️ 仅够 three 使用，非完整实现 |
| `createImageBitmap` | **故意为 `undefined`** | ✅ 让 three 走降级分支 |
| `FileReader` / `WebSocket` / `AudioContext` | 缺省或透传 | ⚠️ 业务需要时按 `docs/08` 扩展 |
| `Worker` / `WebAssembly` | 透传宿主全局（`WXWebAssembly`） | 🟡 |
| `ResizeObserver` | no-op | ⚠️ |
| 完整 DOM（布局、CSS、事件冒泡树） | 不提供 | ❌ 超出范围 |

## 11.5 场景回归记录

以 three 官方示例场景为主体建立回归集，用 `examples/` 的三个平台工程逐一接入验证。

| 类别 | 覆盖目标 | 状态 | 备注 |
| --- | --- | --- | --- |
| `controls_*` | OrbitControls / TrackballControls / TransformControls 的多指交互 | ⬜ 未回归 | 优先验证 pointerId、capture、`pointercancel` |
| `loader_*` | GLTF / DRACO / KTX2 / OBJ / FBX | ⬜ 未回归 | 需配置 decoder 路径与分包 |
| `postprocessing_*` | EffectComposer / bloom / SSAO | ⬜ 未回归 | 注意深度缓冲与 render target 尺寸 |
| `animation_*` / `physics_*` | 骨骼动画 / wasm 物理 | ⬜ 未回归 | 涉及 wasm 资源预下载 |
| 基础渲染 | `examples/wechat-minigame`、`wechat-miniprogram`、`h5` | ✅ 单元级 | 32 个 Vitest 用例覆盖画布、事件、作用域、插件 |

每回归一条，在本表追加：`场景 id | three 版本 | 基础库 | 设备 | 结果 | 失败原因 | 新增 polyfill`。

## 11.6 已知限制汇总

1. 不模拟 WebGPU；`three/webgpu` 项目需改用 WebGL 构建目标。
2. `createImageBitmap` 恒为 `undefined`，依赖该 API 的库需自带降级。
3. 不提供完整 DOM；DOM 密集型 UI 库应走 WebView 方案。
4. 插件默认只改写 `node_modules` 中的三方生态代码；应用代码里直接写 `window` 不会自动改写（可开 `includeUserCode`）。
5. 对象 URL 是 `mini-three-blob:` + `data:`，不是浏览器 `blob:`；若有库硬编码 `blob:` 前缀判断，需要适配。
6. Worker 分包、`.wasm.br`、iOS 高性能+ 需业务按 `mini-three-assets.json` 的 `gameJsonSuggestion` 自行配置，插件不直接改 `game.json`。
