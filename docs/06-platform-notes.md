# 06 · 微信小游戏平台差异、已知坑与诊断

> 平台规范：[微信开放文档 · Adapter](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)、[渲染](https://developers.weixin.qq.com/minigame/dev/guide/base-ability/render.html)、[WXWebAssembly](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html)、[iOS 高性能模式](https://developers.weixin.qq.com/minigame/dev/guide/game-engine/unity-webgl-transform/Design/iOSOptimization.html)，以及小游戏配置（game.json）说明。

## 6.1 运行时基本事实

| 事实 | 对本适配层的约束 |
| --- | --- |
| iOS = JavaScriptCore，Android = V8；**无 DOM/BOM**，无全局 `document`/`window` | 必须由 `MiniThreeScope` 提供 shim |
| 基础库不附带 DOM 兼容层，需由应用自行引入 | 适配层不假设宿主已存在任何兼容对象 |
| 首次 `wx.createCanvas()` 得到唯一**上屏画布**，后续均为离屏 | `getScreenCanvas()` 必须只调用一次并缓存；能力探测只能用 `createOffscreenCanvas` |
| `Canvas.getContext('webgl2')` 返回标准 WebGL2 上下文 | three ≥ r163 需要 WebGL2；默认 `defaultContextType: 'webgl2'` |
| `wx.setPreferredFramesPerSecond` 可锁帧 | `createWeChatGameRuntime({ preferredFps })` |
| 基础库 2.13.0+ `WXWebAssembly`，2.15.0+ Worker 内可用；支持 `.wasm` / `.wasm.br` | 插件 `brotli` 选项、资产分包 |
| Worker 并发上限 **1**，目录只能放 JS，分包需先 `preDownloadSubpackage` | 所有 worker/wasm 输出到一个 `outputDir` |
| iOS 高性能+ 建议用于 WebGL2 / 内存压力大的游戏 | `game.json` 的 `iOSHighPerformance+`；见 §6.5 |

## 6.2 导入顺序（最容易踩的坑）

ESM 静态导入会在模块体执行之前求值。若入口文件顶部写了 `import * as THREE from 'three'`，而 `createRuntime()` 在下面才执行，则 three 模块初始化期间读到的仍是占位作用域。

**推荐**：入口只导入适配层，用动态 import 加载场景：

```ts
import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';
const runtime = await createWeChatGameRuntime();
const { startScene } = await import('./scene.js'); // scene.js 里才 import three
```

**兜底**：`createWeChatGameRuntime({ installGlobals: true })`，把 shim 显式挂到 `globalThis`（可逆），适合无法改导入结构的老项目。

诊断：占位作用域在真正取属性时会抛
`Scoped global "xxx" was read before a runtime was created`，直接提示上述两种解法。

## 6.3 已知坑位与处理

| 症状 | 原因 | 本项目处理 |
| --- | --- | --- |
| `createImageBitmap` 相关报错 | PC 小程序提供了该函数却没有原生 `Blob` | `scope.createImageBitmap = undefined`，插件 `forceUndef` 保证 three 走降级分支 |
| `PMREMGenerator.fromScene` 返回纯黑贴图 | 部分设备 WebGL 深度缓冲未清除 | 不在运行时改写 `WebGLRenderer.render`。应用层按需：每次 render 后 `renderer.clearDepth()`，或配置 `renderer.autoClearDepth`。见下方代码 |
| 开发者工具报 `Unexpected token` | `node_modules` 里用了较新语法 | 构建 `target: 'es2019'`（消除 `?.` / `??`）；必要时开发者工具开启「将 JS 编译成 ES5」或加 Babel |
| 多指触摸卡死 / 包围盒历史数据报错 | 事件桥缓存的包围盒在多指场景失效 | `PointerBridge` 用 pointerId 状态机 + 单一缓存 rect，`touchcancel` 会清理指针 |
| `getExtension` 返回数字而非对象 | 部分 Android 基础库 | `normalizeWebGL: true`（默认）把数值/布尔归一成对象或 `null`，并补 `drawingBufferWidth/Height` |
| `instanceof HTMLCanvasElement` 为 false | wx canvas 不是 DOM 类实例 | `Symbol.hasInstance` + `WeakSet` 注册表 |
| 用 `new Proxy(canvas)` 后渲染异常 | 微信内部 WeakMap 按对象身份校验 | **禁止** Proxy / 克隆 / 改原型，只 `defineProperty`（ADR-0004） |
| 重复调用 `wx.createCanvas()` 导致黑屏 | 第二个画布是离屏的，不显示 | `getScreenCanvas()` 缓存；额外画布一律走 `createOffscreenCanvas` / `runtime.createCanvas()` |
| WebGPU 相关 API 报错 | 小游戏无 WebGPU | 插件 `webgpu` 策略；默认告警 |
| three 版本升级后控件失效 | r170+ 用 `three/addons/`，`outputColorSpace` 取代 `outputEncoding` | 示例与 `rendererHints` 使用新 API；插件 include 覆盖两种路径 |
| `img.onload` / `addEventListener('load')` 永不触发，纹理靠超时兜底 | 图片 shim 只建了「合成事件 → 用户回调」这条边，没有「原生 load → 合成事件」 | `createImageFactory` 在 patch 前抓原生 `onload`/`onerror` 描述符并挂转发器；宿主不可拦截时 `warnOnce` 告警（`image has no writable onload/onerror`） |
| `canvas.onpointerdown = fn` 之类行内处理器不触发 | 事件方法被绑定到内部对象，`this['on'+type]` 查找落空 | `patchEventTarget` 把宿主对象作为行内处理器宿主传入 |

深度缓冲补丁（应用层显式启用）：

```ts
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  // 仅当遇到 PMREM / 后处理黑屏时开启，会有额外开销
  if (needsDepthWorkaround) renderer.clearDepth();
});
```

## 6.4 尺寸 / DPR / 安全区

- `windowInfo.pixelRatio = min(rawPixelRatio, pixelRatioCap)`，默认上限 2（避免 3~4 倍 DPR 造成 GPU 压力）。
- `runtime.on('resize', ...)` 里同步更新 `camera.aspect`、`renderer.setSize(w, h, false)`、`renderer.setPixelRatio(...)`。
- 小程序里 `getCanvasRect()` 通过 `createSelectorQuery().fields({node, rect, size})` 异步获取；`runtime.resize()` 会重新查询并更新事件桥的 rect 缓存。
- 若基础库没有 `wx.onWindowResize`，`WindowInfoStore` 会告警，业务需主动 `await runtime.resize()`。
- `safeArea` 在 `WindowInfo.safeArea` 中透出（若平台提供）。

## 6.5 包体、分包与高性能模式

- 官方文档标注单个主包/分包 ≤ 4MB、总包 ≤ 8MB（**以控制台当前额度为准**）。
- three 本体建议用 `manualChunks` 拆成独立 chunk 并放入分包；示例见 [`examples/wechat-minigame/vite.config.ts`](../examples/wechat-minigame/vite.config.ts)。
- `mini-three-assets.json` 会给出 `game.json` 建议：worker 目录设为 `{ path: 'assets/three', isSubpackage: true }`，并在创建 Worker 前调用 `wx.preDownloadSubpackage({ packageType: 'workers' })`。
- `.wasm.br` + Brotli 是官方推荐的减包手段。
- iOS 高性能模式（`iOSHighPerformance: true`）下内存限制更严，代码分包基本是必须的；高性能+（`iOSHighPerformance+: true`）把渲染移回微信进程，官方明确建议使用 WebGL2 且内存压力大的游戏开启，开启后需验证进程内存、渲染兼容性与帧耗时。

## 6.6 能力探测与降级

`runtime.report()` 输出：

```
mini-three-adapter capability report
  platform            : wechat-game
  baseLibraryVersion  : unknown
  WebGL2 / WebGL1     : true / true
  WebGL2 source       : probe
  offscreenCanvas     : true
  worker / wasm       : false / true (brotli: true)
  nativeImage         : true
  triggerGC           : true
  getWindowInfo       : true (resize events: true)
```

- `probeContext()` 优先用 `wx.createOffscreenCanvas({type:'webgl2'})` 探测并主动 `WEBGL_lose_context` 释放，**不会**占用上屏画布。
- 离屏不可用（或离屏不支持 WebGL2）时，小游戏绑定会回退到**第二次** `wx.createCanvas()` 实测——此时上屏画布已解析，新画布必然离屏。小程序绑定不做这个回退：它的画布节点来自选择器查询，直接探测会用默认属性抢先创建真实上下文。决策见 [ADR-0007](./adr/0007-capability-probe-fallback.md)。
- 两者都无法判定时返回 `undefined`，`webgl2` 按基础库版本推断，`webgl2Source` 标为 `'inferred'` 并告警一次。**「探测不到」不等于「不支持」**。
- 探测结果可用 `capabilities` 选项覆盖（用于测试或已知机型分级），此时 `webgl2Source` 为 `'override'`。
- 实测 `webgl2: false` 时会告警，但**不会静默降级到 WebGL1**——three ≥ r163 本来就要求 WebGL2，静默降级只会延后报错。
- `wx.createImage` 不存在时回退 `OffscreenCanvas.createImage()`；`triggerGC` 存在与否会影响 image 创建路径的选择。

## 6.7 诊断命令 / 日志

```ts
const runtime = await createWeChatGameRuntime({
  logLevel: 'debug',
  reporter: (level, message, payload) => myLogger(level, message, payload),
});
console.log(runtime.report());
runtime.on('contextlost', () => console.warn('WebGL context lost, rebuild resources'));
```

`warnOnce(key, ...)` 保证每帧的重复问题只报一次；`plugin.api.report()` 给出构建期统计。
