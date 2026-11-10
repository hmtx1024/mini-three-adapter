# 04 · API 参考

> 版本：0.1.3。所有签名以 `src/**` 与 `npm run build` 生成的 `dist/*.d.ts` 为准。
> 子路径导入可最大化 tree-shaking；`mini-three-adapter` 是汇总入口。

## 4.1 子路径

| 子路径 | 内容 |
| --- | --- |
| `mini-three-adapter` | 全部公开 API |
| `mini-three-adapter/core` | 平台无关运行时 |
| `mini-three-adapter/scope` | `getActiveScope()` 等（**构建插件注入的 import 目标**） |
| `mini-three-adapter/wechat-game` | 小游戏入口 |
| `mini-three-adapter/wechat-miniprogram` | 小程序入口 |
| `mini-three-adapter/browser` | 浏览器 / H5 / Node 测试 |
| `mini-three-adapter/polyfills` | 独立 polyfill |
| `mini-three-adapter/vite` | Vite 插件 |
| `mini-three-adapter/rollup` | Rollup 插件 + 高级 API |
| `mini-three-adapter/plugin` | `vite` 的别名 |
| `mini-three-adapter/package.json` | 读取包元信息（`version`、`exports`） |

---

## 4.2 生命周期

### `createRuntime(platform, options?) => Promise<MiniThreeRuntime>`

平台无关的总装配入口。通常不直接调用，而用下面的平台快捷函数。

```ts
function createRuntime(
  platform: PlatformBinding | PlatformFactory,
  options?: RuntimeOptions,
): Promise<MiniThreeRuntime>;
```

### `createWeChatGameRuntime(options?) => Promise<MiniThreeRuntime>`

```ts
interface WeChatGameOptions {
  wx?: WxLike;                       // 注入 wx（测试/非微信宿主）
  canvas?: WxCanvas;                 // 复用已有上屏画布
  capabilities?: Partial<Capabilities>;
  diagnostics?: Diagnostics;
  preferredFps?: number;             // wx.setPreferredFramesPerSecond
}
type WeChatGameRuntimeOptions = WeChatGameOptions & RuntimeOptions;
```

另有 `createWeChatGameBinding(options) => PlatformBinding`（同步）、`getScreenCanvas(wx, supplied?)`、`resetScreenCanvasCache()`（测试用）。

### `createWeChatMiniProgramRuntime(options) => Promise<MiniThreeRuntime>`

```ts
interface WeChatMiniProgramOptions {
  wx?: WxLike;
  selector: string;                  // 例如 '#gl'
  selectorCtx?: SelectorCtx;         // 自定义组件内传 this
  queryDelay?: number;               // 等待布局的毫秒数
  capabilities?: Partial<Capabilities>;
  diagnostics?: Diagnostics;
}
```

另有 `createWeChatMiniProgramBinding(options) => Promise<PlatformBinding>`。

### `createBrowserRuntime(options?) => Promise<MiniThreeRuntime>`

```ts
interface BrowserPlatformOptions {
  canvas?: HTMLCanvasElement;
  capabilities?: Partial<Capabilities>;
  diagnostics?: Diagnostics;
}
```

---

### `RuntimeOptions`

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `pixelRatioCap` | `number` | `2` | 限制 DPR，`0` 表示不封顶 |
| `propagatePointerEvents` | `boolean` | `true` | 是否同时派发到 `document` / `window` |
| `emitMouseEvents` | `boolean` | `true` | 是否额外发 `mouse*` / `click` |
| `defaultContextType` | `'webgl2' \| 'webgl' \| '2d'` | `'webgl2'` | `document.createElement('canvas')` 的默认上下文 |
| `cacheContexts` | `boolean` | `true` | 缓存 `getContext()` 结果，保证上下文身份稳定 |
| `normalizeWebGL` | `boolean` | `true` | 修正 `getExtension` 返回值、`drawingBufferWidth/Height` |
| `fpsCap` | `number` | `0` | 逻辑帧率上限 |
| `slowFrameThreshold` | `number` | `0` | 慢帧告警阈值（ms） |
| `logLevel` | `'silent' \| 'error' \| 'warn' \| 'info' \| 'debug'` | `'warn'` | 日志级别 |
| `reporter` | `Reporter` | console | 自定义日志出口 |
| `capabilities` | `Partial<Capabilities>` | — | 覆盖探测结果 |
| `installGlobals` | `boolean` | `false` | 启动时立即注入全局（可逆） |
| `diagnostics` | `Diagnostics` | — | 平台层注入（平台 options） |

### `MiniThreeRuntime`

| 成员 | 类型 | 说明 |
| --- | --- | --- |
| `canvas` | `HTMLCanvasElement` | 已就地补丁的上屏/节点画布 |
| `scope` | `MiniThreeScope` | 三方代码可见的作用域对象 |
| `document` | `DocumentLike` | `createElement` / `createElementNS` / `body` / `defaultView` |
| `capabilities` | `Capabilities` | 探测结果 |
| `diagnostics` | `Diagnostics` | 日志与报告 |
| `frames` | `FrameScheduler` | rAF / delta / fps |
| `bridge` | `PointerBridge` | 事件桥 |
| `windowInfo` | `WindowInfo` | 实时尺寸与 DPR（getter） |
| `rendererHints` | `RendererHints` | 可直接展开给 `new THREE.WebGLRenderer()` |
| `disposed` | `boolean` | 是否已释放 |
| `handleTouch(event, opts?)` | `(TouchLikeEvent, {propagate?, computeRect?}) => void` | 手动转发触摸（小程序必需） |
| `resize()` | `() => Promise<void>` | 重新测量并广播 resize |
| `installGlobals(opts?)` | `() => Disposer` | 显式全局注入并返回还原函数 |
| `createCanvas(w?, h?, type?)` | `() => HTMLCanvasElement` | 额外的离屏画布 |
| `on(event, listener)` | `() => Disposer` | 见下表 |
| `report()` | `() => string` | 能力报告文本 |
| `dispose()` | `() => void` | 释放全部副作用 |

`RuntimeEvents`：

| 事件 | 回调 |
| --- | --- |
| `resize` | `(info: WindowInfo) => void` |
| `visibilitychange` | `(visible: boolean) => void` |
| `contextlost` | `() => void` |
| `dispose` | `() => void` |
| `error` | `(error: Error) => void` |

`RendererHints`：`{ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, outputColorSpace: 'srgb' }`。

---

## 4.3 作用域

```ts
function createScope(overrides?: Partial<MiniThreeScope>): MiniThreeScope;
function getActiveScope(): MiniThreeScope;         // 未初始化时返回「可 typeof、取值即抛错」的占位
function setActiveScope(scope: MiniThreeScope | null): () => void;
function hasActiveScope(): boolean;
function installGlobals(scope, options?): () => void;
```

`MiniThreeScope` 同时扮演 `window` / `self` / `globalThis`（三者指向自身），并包含：

- 领域对象：`document`、`navigator`、`screen`、`performance`、`getComputedStyle`、`matchMedia`；
- 尺寸：`innerWidth`、`innerHeight`、`outerWidth`、`outerHeight`、`devicePixelRatio`、`pageXOffset`、`pageYOffset`（均为 live getter）；
- 事件：`Event`、`EventTarget`、`CustomEvent`、`PointerEvent`、`MouseEvent`、`TouchEvent`、`MessageEvent`、`ProgressEvent`、`KeyboardEvent`、`DOMException`；
- DOM：`HTMLElement`、`HTMLCanvasElement`、`HTMLImageElement`、`OffscreenCanvas`、`Image`、`ImageData`、`DOMRect`、`WebGLRenderingContext`、`WebGL2RenderingContext`、`AudioContext`；
- 网络/编码：`Blob`、`URL`、`TextEncoder`、`TextDecoder`、`fetch`、`XMLHttpRequest`、`AbortController`、`AbortSignal`、`atob`、`btoa`；
- 帧：`requestAnimationFrame`、`cancelAnimationFrame`；
- 明确不可用：`createImageBitmap`、`FileReader`、`WebSocket` 为 `undefined`（让 three 走降级分支）。

`installGlobals(scope, { target?, skipExisting?, extraKeys? })` 把上述键定义为 `globalThis` 上的 getter；返回的 disposer 会精确还原原有 descriptor。

---

## 4.4 core 子路径

| API | 签名 / 说明 |
| --- | --- |
| `patchElement(instance, options)` | 就地补 DOM 属性，返回 `{ element, updateRect, disposers }` |
| `createMockClass(name)` | 生成带 `Symbol.hasInstance` + `WeakSet` 的构造器 shim |
| `markAs(ctor, obj)` / `isMarked(ctor, obj)` | 注册 / 查询 instanceof 关系 |
| `*Shim` | `HTMLCanvasElementShim`、`HTMLImageElementShim`、`HTMLElementShim`、`OffscreenCanvasShim`、`ImageDataShim`、`WebGLRenderingContextShim`、`WebGL2RenderingContextShim`、`DOMRectShim` |
| `patchCanvas(raw, options)` | 返回 `{ canvas, contexts, updateRect, element, disposers }` |
| `createOffscreenCanvas(wx, w?, h?, options?)` | 直接创建并补丁离屏画布 |
| `createImageFactory(wx, diagnostics?)` | `{ Image, HTMLImageElement, ImageData, createImage, createImageData, createImageBitmap: undefined }`。工厂会把底层 `wx` 图片的**原生** `onload`/`onerror` 桥接成合成事件：`img.onload = fn` 与 `addEventListener('load', fn)` 都能收到通知，`decode()` 也据此 settle |
| `createDocument(options)` / `createScreen(w, h)` / `ShimDOMRect` | 伪 DOM 容器 |
| `PointerBridge` | `dispatch(event, opts?)`、`dispatchMouse(event)`、`setRect`、`refreshRect`、`setPointerCapture`、`releasePointerCapture`、`activePointerCount`、`dispose` |
| `createFrameScheduler(raf, caf, options)` | `request` / `cancel` / `loop(cb)` / `setFpsCap` / `fps` / `dispose` |
| `createWindowInfoStore(wx, options)` | `info` / `refresh()` / `onChange()` / `setPixelRatioCap()` / `dispose()` |
| `detectCapabilities(wx, platform, options)` / `versionAtLeast(a, b)` | 能力探测。`options.probeContext(type)` 返回 `true` / `false` / `undefined`，**`undefined` 表示「探测不到」而不是「不支持」**，此时 `webgl2` 按基础库版本推断并在 `webgl2Source` 里标记为 `'inferred'` |
| `createDiagnostics(level, reporter)` / `capabilityReport(caps)` | 日志与报告 |
| `currentScope()` | 返回当前作用域或 `null` |

### `PlatformBinding`（新增平台时实现）

```ts
interface PlatformBinding {
  readonly kind: 'wechat-game' | 'wechat-miniprogram' | 'browser' | 'unknown';
  readonly wx?: WxLike;
  readonly rawCanvas: WxCanvas;
  readonly capabilities: Capabilities;
  readonly imageFactory: ImageFactory;
  getCanvasRect(): Rect | Promise<Rect>;
  createOffscreenCanvas(w: number, h: number, type: ContextType): WxCanvas;
  watchTouch(handler: (e: TouchLikeEvent) => void): Disposer;
  watchVisibility(handler: (visible: boolean) => void): Disposer;
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  now(): number;
  dispose(): void;
}
```

---

## 4.5 polyfills 子路径

| API | 说明 |
| --- | --- |
| `MiniEvent` / `MiniCustomEvent` / `MiniPointerEvent` / `MiniMouseEvent` / `MiniMessageEvent` / `MiniProgressEvent` / `MiniDOMException` | 事件对象 |
| `MiniEventTarget` / `patchEventTarget(obj)` | 事件目标；`patchEventTarget` 不改变对象身份。监听器被调用时 `this`、`event.target`、`event.currentTarget` 都是**宿主元素**而不是内部载体——three 的 `ImageLoader` 用 `this` 取 `<img>` 当纹理源，拿错对象就等于没有像素 |
| `MiniBlob` | `bytes()`、`arrayBuffer()`、`text()`、`slice()`、`dataURL()`、`size`、`type` |
| `MiniURL` | `createObjectURL` / `revokeObjectURL` / `resolveObjectURL` / `clearObjectURLs`；构造器支持相对路径解析 |
| `MiniURLSearchParams` | `get` / `set` / `toString` |
| `bytesToBase64` / `base64ToBytes` / `resolveUrl` | 编码与 URL 工具 |
| `atob` / `btoa` / `MiniTextEncoder` / `MiniTextDecoder` | 编码 |
| `createFetch(wx)` / `MiniXMLHttpRequest` / `createXMLHttpRequestFactory(wx)` / `MiniAbortController` / `MiniAbortSignal` | 网络 |

> 注意：对象 URL 采用 `mini-three-blob:` 前缀并解析为 `data:` URI，而不是浏览器 `blob:` ——因为微信 image loader 只认 `data:` / 本地路径。

---

## 4.6 构建插件

### Vite

```ts
import miniThree from 'mini-three-adapter/vite';
plugins: [miniThree(options)];
```

插件额外提供 `config()`，设置 `optimizeDeps.exclude: ['three', 'three-stdlib', 'three/examples/jsm']`，确保 AST 重写见到原始 ESM 模块图。

### Rollup

```ts
import { miniThree } from 'mini-three-adapter/rollup';
plugins: [miniThree(options)];
```

### `MiniThreePluginOptions`

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `include` | `(id: string) => boolean` | 匹配 `three` / `three-stdlib` / `@react-three` / `@tresjs` / `.vite/deps/three*` | 需要重写的模块 |
| `exclude` | `(id: string) => boolean` | `() => false` | 排除 |
| `includeUserCode` | `boolean` | `false` | 是否也改写应用代码 |
| `rewrite` | `RewriteOptions` | — | 高级重写配置 |
| `webgpu` | `'warn' \| 'error' \| 'rewrite' \| 'ignore'` | `'warn'` | 遇到 `three/webgpu` 的策略 |
| `roots` | `string[]` | three jsm/libs、`three-stdlib`、`public`、`static` | 资源搜索目录 |
| `outputDir` | `string` | `'assets/three'` | 资源输出目录 |
| `brotli` | `boolean` | `true` | 同时拷贝 `.wasm.br` |
| `manifest` | `boolean` | `true` | 输出 `mini-three-assets.json` |
| `cwd` | `string` | `process.cwd()` | 解析 roots 的根目录 |
| `report` | `boolean` | `true` | 打印构建摘要 |
| `debug` | `boolean` | `false` | 逐模块日志 |

### `RewriteOptions`

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `globals` | `DEFAULT_GLOBAL_NAMES` | 替换默认清单（而非追加） |
| `extraGlobals` | `[]` | 追加清单 |
| `forceUndef` | `['createImageBitmap']` | 强制走 `__m3().x`（作用域中恒为 `undefined`） |
| `accessor` | `'__m3'` | 注入的 `getActiveScope` 别名 |
| `scopeModule` | `'mini-three-adapter/scope'` | 注入的 import 路径 |

### 高级导出（`mini-three-adapter/rollup`）

`rewriteGlobals(code, id, options)`、`DEFAULT_GLOBAL_NAMES`、`DEFAULT_FORCE_UNDEF`、`collectAssetReferences`、`collectAssets`、`copyAssets`、`miniThreePlugin`。

`plugin.api.report()` → `BuildReport`：`modulesScanned`、`modulesRewritten`、`rewrites`、`globalsSeen`、`assetReferences`、`missingAssets`、`webgpuWarnings`、`parseFailures`。

---

## 4.7 类型速查

```ts
interface Capabilities {
  platform: 'wechat-game' | 'wechat-miniprogram' | 'browser' | 'unknown';
  webgl2: boolean;
  /** 'probe' 实测 / 'inferred' 版本推断 / 'override' 调用方覆盖 */
  webgl2Source?: 'probe' | 'inferred' | 'override';
  webgl1: boolean; offscreenCanvas: boolean;
  worker: boolean; wasm: boolean; brotliWasm: boolean; nativeImage: boolean;
  triggerGC: boolean; getWindowInfo: boolean; windowResizeEvent: boolean;
  baseLibraryVersion: string;
}

interface WindowInfo {
  width: number; height: number; pixelRatio: number; rawPixelRatio: number;
  safeArea?: Rect;
}

interface Rect { top: number; left: number; width: number; height: number; right: number; bottom: number; }

interface TouchLikeEvent {
  type: string; touches?: ArrayLike<TouchPoint>;
  changedTouches?: ArrayLike<TouchPoint>; timeStamp?: number;
  [key: string]: unknown;
}
```
