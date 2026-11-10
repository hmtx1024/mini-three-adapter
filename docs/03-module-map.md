# 03 · 模块地图（AI 修改入口索引）

> **给 AI 用**：动手前先在这张表里定位目标文件；「改这里」列给出常见需求的最小改动面，「会影响」列给出必须同步检查的下游。
> 依赖层级：`types → scope / polyfills → core → platforms`；`build` 是独立分支。

## 3.1 根与协议层

| 文件 | 职责 | 关键导出 | 改这里 | 会影响 |
| --- | --- | --- | --- | --- |
| `src/types.ts` | 全部公开类型，纯 type-only | `Rect`、`WindowInfo`、`Capabilities`、`PatchedCanvas`、`TouchLikeEvent`、`FrameScheduler`、`RuntimeEvents` 等 | 新增平台能力字段、事件名称 | `core/*`、`platforms/*`、`dist/*.d.ts`、`docs/04` |
| `src/scope.ts` | 作用域协议：`MiniThreeScope`、活动作用域单例、显式全局注入 | `createScope`、`getActiveScope`、`setActiveScope`、`hasActiveScope`、`installGlobals` | 新增三方代码可能访问的浏览器全局 | **构建插件注入的 import**、[ADR-0001](./adr/0001-scoped-globals.md)、`docs/04` |
| `src/index.ts` | 汇总导出 | 全部公开 API | 新增公共入口 | `package.json` `exports`、`docs/04` |
| `src/core/index.ts` | core 子路径导出 | core API | 同上 | `docs/04` |
| `src/polyfills/index.ts` | polyfills 子路径导出 | polyfill API | 同上 | `docs/04` |

## 3.2 polyfills（自包含，无平台知识）

| 文件 | 职责 | 关键导出 | 改这里 | 会影响 / 测试 |
| --- | --- | --- | --- | --- |
| `src/polyfills/event.ts` | W3C 事件系统，`patchEventTarget` 把方法绑到内部载体但把 `this` / `event.target` / `currentTarget` 转发给宿主元素 | `MiniEvent`、`MiniPointerEvent`、`MiniMouseEvent`、`MiniEventTarget`、`patchEventTarget`、`MiniDOMException` | 事件字段缺失（如 controls 读 `movementX`）、`onxxx` 内联处理器、监听器拿不到事件目标 | `pointer.ts`、`dom.ts`；`tests/polyfills.test.ts`、`tests/event-dispatch.test.ts` |
| `src/polyfills/blob-url.ts` | Blob / URL / base64 / URL 相对解析 | `MiniBlob`、`MiniURL`、`bytesToBase64`、`resolveUrl` | `createObjectURL` 的目标格式、URL 解析边界 | `image.ts` 的 `src` 解析；`tests/polyfills.test.ts` |
| `src/polyfills/text-encoding.ts` | `atob`/`btoa`/`TextEncoder`/`TextDecoder` | 同名 | 编码边界、BOM、utf-16 | `network.ts`、`blob-url.ts`；`tests/polyfills.test.ts` |
| `src/polyfills/network.ts` | `fetch`、`XMLHttpRequest`、`AbortController` | `createFetch`、`createXMLHttpRequestFactory`、`MiniAbortController` | `wx.request` 返回结构差异、进度事件 | `runtime.ts` 的 scope 组装；`tests/polyfills.test.ts` |

> 约束：polyfills 不得 import `core/*`，不得读取 `globalThis.wx`。

## 3.3 core（平台无关运行时）

| 文件 | 职责 | 关键导出 | 改这里 | 会影响 / 测试 |
| --- | --- | --- | --- | --- |
| `src/core/platform.ts` | **平台契约**（结构化接口，替代抽象基类） | `PlatformBinding`、`PlatformFactory` | 平台要新增能力时**先改这里** | 所有 `platforms/*`、`runtime.ts` |
| `src/core/runtime.ts` | **总装配**：画布补丁、scope 组装、订阅、生命周期 | `createRuntime`、`MiniThreeRuntime`、`RuntimeOptions`、`RendererHints` | 新增 runtime API、新增/移除全局项、调整启动顺序 | 几乎所有模块；`tests/runtime.test.ts` |
| `src/core/element.ts` | 就地 DOM 属性补丁 + `Symbol.hasInstance` 注册表 | `patchElement`、`createMockClass`、`*Shim`、`normalizeRect` | three 报「DOM 属性缺失」、`instanceof` 失败 | `canvas.ts`、`image.ts`、`dom.ts` |
| `src/core/canvas.ts` | canvas 补丁：getContext 缓存、WebGL 归一化、离屏画布 | `patchCanvas`、`createOffscreenCanvas` | 上下文丢失、扩展返回值异常、`canvas.canvas` 指向 | `dom.ts`、`runtime.ts`；`tests/runtime.test.ts` |
| `src/core/image.ts` | Image / ImageData 工厂，blob URL → data URL，**原生 `onload`/`onerror` → 合成事件桥接** | `createImageFactory`、`ShimImageData` | 图片加载、crossOrigin、decode、事件不触发 | `platforms/*`、`dom.ts`；`tests/image-events.test.ts` |
| `src/core/dom.ts` | `document` / `body` / `screen` / `DOMRect` / `OffscreenCanvas` 构造器 | `createDocument`、`createScreen`、`ShimDOMRect`、`createOffscreenCanvasCtor` | `document.createElement` 新标签、`visibilityState` | `runtime.ts` |
| `src/core/pointer.ts` | **touch → pointer/mouse 状态机** | `PointerBridge` | 多指、capture、`tap` 无 touches、坐标换算 | `runtime.ts`、`examples/*`；`tests/runtime.test.ts` |
| `src/core/frames.ts` | rAF 包装、delta、fpsCap、FPS 测量 | `createFrameScheduler` | 帧率限制、慢帧告警 | `runtime.ts` |
| `src/core/window-info.ts` | 窗口信息 + DPR 封顶 + resize 广播 | `createWindowInfoStore`、`readWindowInfo` | 新 API 替代 `getWindowInfo`、安全区 | `runtime.ts`；`tests/runtime.test.ts` |
| `src/core/capabilities.ts` | 能力探测（离屏优先，主画布回退；**不消费上屏画布**） | `detectCapabilities`、`versionAtLeast`、`webgl2Source` | 新增探测项、「探测不到」的语义 | 所有 `platforms/*`、`runtime.report()`；`tests/capabilities.test.ts` |
| `src/core/diagnostics.ts` | 分级日志、`warnOnce`、能力报告 | `createDiagnostics`、`capabilityReport` | 日志格式、报告字段 | 全局；`tests/runtime.test.ts` |

> 约束：`core/*` 不得 import `platforms/*`，不得 import `three`，不得直接写 `globalThis`。

## 3.4 platforms（平台差异收敛点）

| 文件 | 职责 | 关键导出 | 改这里 | 会影响 |
| --- | --- | --- | --- | --- |
| `src/platforms/wx-types.ts` | 手写最小 `wx` 结构化类型（不依赖官方 typings） | `WxLike`、`WxCanvas`、`WxTouchEvent`、`resolveWx` | 用到新的 `wx.*` API 时补类型 | 所有平台；`docs/04` |
| `src/platforms/wechat-common.ts` | rAF / now / touch / visibility / 离屏画布 / 能力探测共用实现 | `watchWxTouch`、`createRafPair`、`probeContext`（返回 `boolean \| undefined`，按 `screenCanvas` 身份拒绝探测上屏画布）等 | 微信 API 变更、探测回退策略（ADR-0007） | `wechat-game.ts`、`wechat-miniprogram.ts` |
| `src/platforms/wechat-game.ts` | 小游戏绑定 + 入口 | `createWeChatGameRuntime`、`createWeChatGameBinding`、`getScreenCanvas` | **上屏画布获取顺序**、锁帧 | `examples/wechat-minigame` |
| `src/platforms/wechat-miniprogram.ts` | 小程序绑定（`createSelectorQuery`） | `createWeChatMiniProgramRuntime` | 选择器查询、组件作用域 `selectorCtx` | `examples/wechat-miniprogram` |
| `src/platforms/browser.ts` | 浏览器 / Node 测试平台 | `createBrowserRuntime`、`createBrowserBinding` | H5 双端能力 | `examples/h5` |

## 3.5 build（Node 侧，不进小游戏 bundle）

| 文件 | 职责 | 关键导出 | 改这里 | 会影响 / 测试 |
| --- | --- | --- | --- | --- |
| `src/build/scope-rewrite.ts` | **AST 全局重写**，`@babel/parser` + `path.scope.hasBinding` | `rewriteGlobals`、`DEFAULT_GLOBAL_NAMES`、`DEFAULT_FORCE_UNDEF` | 需要改写的全局清单、访问器名、注入的 import | 所有三方模块；`tests/scope-rewrite.test.ts`、[ADR-0003](./adr/0003-ast-rewrite.md) |
| `src/build/assets.ts` | worker/wasm 引用扫描、解析、拷贝、manifest | `collectAssetReferences`、`collectAssets`、`copyAssets`、`AssetManifest` | 新 decoder 类型、输出目录、`game.json` 建议 | `plugin-core.ts`；`tests/plugin.test.ts` |
| `src/build/plugin-core.ts` | Rollup/Vite 兼容插件核心 | `miniThreePlugin`、`BuildReport` | include 规则、WebGPU 策略、构建报告 | `vite.ts`、`rollup.ts`；`tests/plugin.test.ts` |
| `src/build/vite.ts` | Vite 入口 + `optimizeDeps.exclude` 配置 | `miniThree`（default） | Vite 版本兼容 | `examples/*/vite.config.ts` |
| `src/build/rollup.ts` | Rollup 入口 + 高级 API 再导出 | `miniThree`、`rewriteGlobals` 等 | Rollup 集成 | `docs/05` |

> 约束：`build/*` 不得 import `core/*` / `platforms/*`；`node:fs` 只允许出现在这里。

## 3.6 配置与示例

| 文件 | 作用 |
| --- | --- |
| `package.json` | `exports` 子路径、`sideEffects`、peer（`three`/`vite`/`rollup` 均 optional） |
| `tsconfig.json` | strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`；`include` 覆盖 `src/tests/config` |
| `tsup.config.ts` | 两套构建：runtime（es2019 / neutral / dts / splitting）与 build tooling（node18 / 无 splitting） |
| `vitest.config.ts` | 单 fork 执行（规避 Windows 临时目录权限），`cache: false` |
| `tests/helpers/mock-wx.ts` | 可注入的 wx 模拟器；`__setSize` 触发 resize，`__touch` 触发触摸 |
| `examples/wechat-minigame/` | 小游戏完整工程（vite + game.json + project.config.json + postbuild） |
| `examples/wechat-miniprogram/` | 小程序页面（WXML 事件转发） |
| `examples/h5/` | H5 双端 |

## 3.7 常见任务 → 文件清单（AI 速查）

| 需求 | 最小改动面 |
| --- | --- |
| three 报 `xxx is not defined` | `src/build/scope-rewrite.ts` 的 `DEFAULT_GLOBAL_NAMES` → `src/scope.ts` 的 `MiniThreeScope` → `src/core/runtime.ts` 组装 |
| 新 three 版本用了新的 DOM 属性 | `src/core/element.ts` `patchElement`（+ canvas 的 `extra`）→ 补 `tests/runtime.test.ts` |
| 触摸在小程序里不生效 | `src/core/pointer.ts`（`tap`/无 touches）→ `examples/wechat-miniprogram/pages/index/index.ts` 转发 |
| 新增一个平台（如抖音小游戏） | 新建 `src/platforms/xxx.ts` 实现 `PlatformBinding` → `src/index.ts` 导出 → `package.json` exports → `docs/08` |
| 新增 decoder 资源 | `src/build/assets.ts` 的 `DECODER_KEYWORDS` / `defaultRoots` → `examples/*/vite.config.ts` 的 `roots` |
| WebGPU 相关代码报错 | `src/build/plugin-core.ts` `webgpu` 策略 → `docs/06` |
| resize 后画面变形 | `src/core/window-info.ts`、`src/core/runtime.ts` 的 `resize()`、`docs/06` |
| 包体过大 | `docs/06`（分包 / Brotli / manualChunks）+ `src/build/assets.ts` |
| 发布新版本 | `docs/09-testing-and-release.md` + `CHANGELOG.md` + `package.json` |

## 3.8 修改后必做

1. `npm run check`（typecheck + 63 例单测 + tsup 构建）。
2. 更新本表（若职责变化）、`docs/04-api-reference.md`（若导出变化）、`CHANGELOG.md`。
3. 若触及架构不变量，新增或修订 `docs/adr/*.md`。
4. 若新增了平台能力，更新 `docs/11-compat-matrix.md`。
