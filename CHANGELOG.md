# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [Unreleased]

## [0.1.7] - 2026-11-13

### Fixed

- **浏览器 / H5：真实 canvas 的 DOM 事件被适配层吞掉（P0）**。`createRuntime()` 对 `binding.rawCanvas` 无条件 `patchCanvas()`，而 `patchElement()` 又无条件执行 `patchEventTarget()`，把 `addEventListener` / `removeEventListener` / `dispatchEvent` 写在真实 `HTMLCanvasElement` 实例上，遮蔽了原生实现。后果：浏览器派发的真实 `pointer` / `touch` / `wheel` / `webglcontextlost` 不触发任何监听器；`canvas.dispatchEvent(realEvent)` 抛 `TypeError: Cannot set property target of #<Event> which has only a getter`；`canvas.style` / `getBoundingClientRect()` / `setPointerCapture()` 也被替换成非原生实现。
  - `PlatformBinding` 新增 `nativeEventTarget` 与 `createEvent`；`browser` 绑定声明 `nativeEventTarget: true` 并提供真实 `PointerEvent` / `MouseEvent` / `Event` 构造器。
  - `patchElement()` 在原生事件目标上跳过 `patchEventTarget()`，并按「补缺不覆盖」处理 DOM 成员：宿主已有的 `style`、`getBoundingClientRect`、`setPointerCapture`、`nodeType` 一律不动（[ADR-0010](./docs/adr/0010-native-event-target-boundary.md)）。
  - `PointerBridge` 通过 `createEvent` 派发真实 DOM 事件；`nativeEventTarget` 为真时不再向 scoped `document` / `window` 转派（浏览器自己冒泡），`dispatchMouse({ type: 'wheel' })` 现在产出真正的 `wheel` 事件并携带 `deltaY`。
  - `MiniEventTarget.dispatchEvent()` 只对 `MiniEvent` 实例写 `target` / `currentTarget`，真实事件不再触发只读赋值异常。
  - `browser` 的 `watchTouch` 在宿主支持 `PointerEvent` 时不再合成触摸事件，避免每次手势被投递两遍；无 `PointerEvent` 的旧内核仍走 touch 兜底。
  - 微信两平台行为不变：`nativeEventTarget` 缺省为 `false`，`patchEventTarget` 照旧。
- **`mini-three-adapter/vite` 的 `transform` 返回类型与 Vite 6 不兼容（P1，示例 `vite.config.ts` 直接报 TS2769）**。`MiniThreePlugin.transform` 把 `map` 声明为 `unknown`，无法赋给 Vite 的 `SourceMapInput`。现在改用具名结构类型 `BuildSourceMap`（`src/build/scope-rewrite.ts` 导出，`magic-string` 的 `SourceMap` 结构上满足），`dist/*.d.ts` 保持自包含，不引入 `rollup` 类型依赖。
- **示例依赖 `workspace:*` 在任何 npm 安装下都无法解析（仓库没有 workspace 配置）**。`examples/h5` 与 `examples/wechat-minigame` 改为 `"mini-three-adapter": "file:../.."`，`npm install` 会建立指向仓库根的软链接，改源码后重新 build 即可联调。

### Tests

- 新增 `tests/native-events.test.ts`（13 例）与 `tests/helpers/mock-native-canvas.ts`：断言原生 `addEventListener` / `dispatchEvent` / `style` / `getBoundingClientRect` 未被覆盖、宿主事件可达应用监听器与 `runtime.on('contextlost')`、bridge 派发真实 `Event`、wheel 携带 `deltaY`、不向 scoped `document` / `window` 转派，以及微信侧 shim 行为不回退。
- 用例从 82 增至 95。

### Examples

- `examples/h5` 补齐 `package.json` / `vite.config.ts` / `tsconfig.json`（此前文档里的 `npm install && npx vite` 实际跑不通），并接上 `OrbitControls`：拖动旋转与滚轮缩放直接由浏览器原生事件驱动，顺带成为 ADR-0010 的可视回归入口。
  - 已在示例目录实跑：`npm install`（24 包）→ `npm run typecheck` → `npm run build`（插件改写 69 处全局引用）→ 真实 Chromium 打开产物，球体正常渲染，鼠标拖拽产生 `pointerdown → pointermove × N → pointerup`，滚轮产生 `wheel` 且视角被 dolly 拉近。
- 新增 `npm run verify:h5`（`scripts/verify-h5-events.mjs`）：在真实 Chromium 里给真实 `<canvas>` 打补丁，断言 13 项事件行为（原生方法未被覆盖、真实事件转发不抛错、`contextlost` 到达 runtime、bridge 派发真实 `PointerEvent`、`style` 生效）。Playwright 是可选依赖，未安装时脚本给出安装命令；`--serve-only` 只起验证页便于手动检查。

### Docs

- 新增 [ADR-0010](./docs/adr/0010-native-event-target-boundary.md)：原生事件目标不做 `EventTarget` 替换，限定 ADR-0004 的适用范围。
- `docs/03` 模块表、`docs/04` 的 `patchElement` / `patchCanvas` / `PointerBridge` / `PlatformBinding`、`docs/06` 报错对照表、`docs/11` 平台支持表同步。

## [0.1.6] - 2026-11-12

0.1.5 的兜底建立在「`onload` 槽被填上就说明宿主会调用它」这个假设上。宿主可能只把赋值存下来、永不调用，
此时每一级都认为已挂上，watchdog 与 `getImageInfo` 都不会启动——比 0.1.4 的静默挂起更难查，因为它连告警都没有。

### Fixed

- **宿主接受 `onload` 赋值但永不调用（P0，纹理依旧无限 pending）**。watchdog 改为**无条件**：只要 `src` 被赋值就上闹钟，与宿主形态无关；真实 `load`/`error` 到达时清掉，终态仍只派发一次。
- watchdog 到点时的判定改为看宿主 `complete`：为真则派发 `load`（`reason: 'watchdog-complete'`），否则派发 `error`（`reason: 'image-events-timeout'`，`detail.path` 指认是哪一级入口看起来挂上了）。慢但成功的加载只要在 2s 内落了 `complete` 就不会被误判。

### Tests

- `tests/image-events.test.ts` 13 → 16 例：新增「接受赋值但不调用」「`complete` 但静默」「真实 load 赢过 watchdog」三条宿主形态。
- 用例从 79 增至 82。

### Docs

- `docs/06` §6.3.1 增加「接受赋值但永不调用」形态与 watchdog 判定规则，并说明 2s 只针对包内纹理、网络大图需预下载。
- `docs/11` 已知限制第 8 条同步：watchdog 对所有宿主生效，>2s 的网络大图会被判失败。

## [0.1.5] - 2026-11-11

图片事件桥接在部分真机上没有入口：0.1.4 只认 `getOwnPropertyDescriptor`，宿主把回调放在原生槽里时读不到，
`TextureLoader` 永远不 settle，启动被业务侧超时拖长。同时补齐 `complete` / `decode()` 的失败语义。

### Added

- `WxLike.getImageInfo`（`WxGetImageInfoOptions` / `WxImageInfo`）：声明宿主的元数据解码能力，供图片桥接的兜底与格式诊断使用。

### Fixed

- **图片事件桥接只认描述符（P0，真机上所有 `TextureLoader` 纹理静默超时）**。`createImageFactory` 改为在 `patchElement` 之前抓四类入口，按「原生 `addEventListener` → 直接赋值 `onload`/`onerror` → `wx.getImageInfo` → 2s watchdog」逐级兜底：描述符是否存在不再是前提，`img.onload = fn` 能触发的宿主也能出图。
- **`src` 为可写数据属性时写入被吞掉（P1）**。shim 的 `src` 访问器会挡住宿主自己的属性，图片永远不开始加载；现在临时还原宿主描述符写一次再装回访问器，且后续写入仍生效。
- **退化宿主静默挂起（P1）**。三种入口都没有时不再等业务侧 8 秒超时：有 `wx.getImageInfo` 就先判定资源是否可读，再派发带 `reason` 的 `error`（`image-events-unavailable` / `getImageInfo-failed`），否则 2s 后由 watchdog 派发 `error`。`wx.getImageInfo` 不解码像素，因此**不**合成 `load`——那会让 three 上传空纹理。
- **`complete` / `decode()` 语义（P2）**。`complete` 在 `error` 后也为 `true`；`decode()` 在失败时 reject、成功时 resolve，且不再依赖覆写用户 `onload`（之前用户在 `decode()` 之后设置 `onload` 会让它永远 pending）。同一次加载只派发一个终态事件。
- 退化路径的 `warnOnce` 带上宿主形状快照（`onload: accessor | data | data-readonly | missing`、`addEventListener`、`getImageInfo`、`ownNames`），可直接贴进 issue。

### Tests

- `tests/image-events.test.ts` 从 5 例扩到 13 例，改用宿主矩阵：描述符宿主、仅原生 `addEventListener`、仅 `getImageInfo`（成功 / 失败）、三者皆无（watchdog）、`src` 数据属性、重复 `load` 去重、`error` 后 `complete`。
- 用例从 71 增至 79。

### Docs

- `docs/06` 新增 §6.3.1「图片事件桥接的宿主形态」：四级兜底表、真机自证脚本、WebP 单独归因。
- `docs/11` 增加图片事件与纹理格式两行，并把「WebP 在部分真机不可解码」写进已知限制。

## [0.1.4] - 2026-11-10

0.1.3 复核报告里的两个遗留项：探测兜底的窄口子（重后果）与占位作用域的 `typeof` 抛错（潜伏）。

### Added

- 新增 `getEarlyScopeReads()` / `clearEarlyScopeReads()`：查询「runtime 创建之前被读过的环境全局名」，便于排查求值过早。
- 新增 `tests/scope.test.ts`（6 例）：占位作用域的两条边界与早读点名。
- 新增 [ADR-0008](./docs/adr/0008-probe-fallback-boundary.md)（探测兜底的边界）、[ADR-0009](./docs/adr/0009-placeholder-scope-environment-globals.md)（占位作用域的环境全局）。
- `tests/capabilities.test.ts` 增加三条用例：无离屏 API 时 `createCanvas()` 零调用、`GameGlobal.screencanvas` 预置 + 显式传 `canvas` 时零触碰、离屏存在但回退拿到预置画布时零触碰。

### Changed

- `ProbeContextOptions.screenCanvas` → `reservedCanvases`：身份比对的基准从「本次使用的画布」扩为「所有可能的上屏画布」（显式传入 / 缓存 / `GameGlobal.screencanvas` / `globalThis.canvas`）。
- 未初始化占位作用域：`document` / `navigator` / `screen` / `location` / `history` 读作 `undefined`，其余键仍然抛带指引的错误。
- 校正文档中过期的数字与版本标注：`docs/09` 的包体描述改为 0.1.3 实测值（74 个文件 / 解包 644 KB / tarball 182 KB），`docs/04` 的版本标注同步到 0.1.3。

### Fixed

- **能力探测：宿主显式传 `canvas` 时身份比对失效（P2，后果仍是黑屏）**。`getScreenCanvas` 走 `supplied` 分支时不写缓存，比对基准取「本次使用的画布」就与 `GameGlobal.screencanvas` 对不上；`createCanvas()` 返回预置的上屏画布时，`getContext` + `WEBGL_lose_context` 照样把它废掉。现在比对基准是候选全集，命中任一即放弃探测并退回 `webgl2Source: 'inferred'`。
- **能力探测：缺 `createOffscreenCanvas` 时仍在兜底**。此时无法判断「首次 `createCanvas()`」是否已被消耗，兜底等于掷硬币，输的那一面是上屏上下文被销毁。现在离屏 API 不存在就直接返回 `undefined`，由 `webgl2Source: 'inferred'` 显式暴露不确定性。
- **`typeof document` 在 runtime 之前仍会抛（BUG-5）**。构建期守卫只覆盖 `typeof X` 这种直接操作数，`typeof window.document`（成员表达式）与未被改写的应用层代码都会落到占位对象上抛错。现在环境探测型全局读作 `undefined`，`typeof` 与真值判断都正常；真实 API 误读仍在发生的那一行报错，并由 `createRuntime()` 的 `warnOnce` 汇总早读。

### Tests

- 用例从 63 增至 71。

## [0.1.3] - 2026-11-10

0.1.2 的复核补充：两个在真机上不报错、但会让贴图静默失效 / 偶发黑屏的缺陷。

### Added

- 新增 `tests/event-dispatch.test.ts`：监听器 `this`、`event.target` / `currentTarget` 指向宿主元素，含 three `ImageLoader` 按 `this` 取 `<img>` 的真实场景。
- `tests/capabilities.test.ts` 增加两条用例：回退 `createCanvas()` 返回上屏画布时按身份放弃（`getContext` 零调用）；`GameGlobal.screencanvas` 预置时 `createWeChatGameBinding` 不触碰屏画布。
- `ProbeContextOptions.screenCanvas`：调用方把上屏画布引用传给 `probeContext`，供回退时做身份比对。

### Fixed

- **运行期：监听器里的 `this` 不是事件目标（P1）**。`patchEventTarget` 把事件方法绑到内部 `MiniEventTarget` 载体上，`dispatchEvent` 里 `record.listener.call(this, ev)` 传出去的是载体，`event.target` / `currentTarget` 同样指向载体。three 的 `ImageLoader.onImageLoad` 用 `this` 取图片存进 `Texture.source.data`，于是 `texture.image` 变成只有 `listeners` / `inlineHost` 的空壳，没有 `src`、没有宽高，`texImage2D` 拿不到像素——法线贴图这类效果静默失效。现在 `this`、`event.target`、`event.currentTarget` 一律转发到宿主元素。
- **能力探测：回退可能废掉上屏画布（P1，宿主未报错但存在黑屏路径）**。宿主若用 `GameGlobal.screencanvas` 预置了上屏画布，`getScreenCanvas()` 直接取用它、没有消耗「首次 `createCanvas()`」；回退分支再调 `createCanvas()` 仍可能拿回同一块上屏画布，`getContext('webgl2')` 抢先建上下文后被 `WEBGL_lose_context.loseContext()` 废掉。现在 `probeContext` 收到 `screenCanvas` 后按对象身份比对，命中即放弃探测并退回 `webgl2Source: 'inferred'`。

### Tests

- 用例从 55 增至 63。
- `tests/event-dispatch.test.ts` 在修复前 4 例失败、1 例通过（独立 `MiniEventTarget` 不经过 `patchEventTarget`，因此本来是对的），修复后 5 例全绿。

## [0.1.2] - 2026-11-10

适配层在小游戏真机上暴露的五个缺陷修复，其中三个 P0 会直接导致构建产物报错或纹理静默丢失。

### Added

- 新增 `tests/image-events.test.ts`（图片原生事件桥接）与 `tests/capabilities.test.ts`（探测回退与 `webgl2Source`）。
- 新增 [ADR-0007](./docs/adr/0007-capability-probe-fallback.md)：能力探测的离屏优先 / 主画布回退 / 无法判定三态策略。
- `docs/05` 新增「按报错文案反查」表，`docs/07` 新增常见报错对照（含 `Class constructor ... cannot be invoked without 'new'` 全文）。

### Changed

- `Capabilities` 新增可选字段 `webgl2Source`（`'probe' | 'inferred' | 'override'`），能力报告同步展示来源，见 [ADR-0007](./docs/adr/0007-capability-probe-fallback.md)。
- `AGENTS.md` 不变量 1 的措辞调整：能力探测默认只用 `wx.createOffscreenCanvas()`，回退到 `createCanvas()` 必须在上屏画布**已解析之后**且显式 opt-in。

### Fixed

- **构建期：`new` 表达式丢失括号（P0）**。`new TextDecoder()` / `new Blob()` / `new OffscreenCanvas()` 曾被改写成 `new __m3().TextDecoder()`，被解析成 `(new __m3()).TextDecoder()`，运行期报 `Class constructor ... cannot be invoked without 'new'`；任何走 `GLTFLoader.parse()` 的项目会在第一行崩溃。现在只给 callee 成员链根加括号：`new (__m3().TextDecoder)()`。
- **构建期：对象简写属性产出语法错误（P0）**。`{ TextDecoder }` 曾被改写成 `{ __m3().TextDecoder }`，产物直接 `SyntaxError`。简写属性的 key/value 是两个区间相同的独立节点，原来的引用相等判断失效；现在改为区间比较并把简写展开成 `{ TextDecoder: (__m3().TextDecoder) }`。
- **运行期：图片 `onload` / `onerror` 永不触发（P0）**。`createImageFactory` 把用户回调存进闭包，却没有把转发器挂到底层 `wx` 图片的原生槽位，导致 `ImageLoader` 两条路径（`addEventListener('load')` 与 `onload`）一起死掉、`decode()` 永不 settle、纹理静默丢失只能靠超时。现在 patch 前先抓原生描述符并挂上转发器，用户回调只登记；宿主无法拦截时用 `warnOnce` 明确告警。
- **运行期：`patchEventTarget` 上的 `onxxx` 行内处理器不触发**。事件方法被绑定到内部对象，`this['on' + type]` 查找永远落在内部对象上，因此 `canvas.onpointerdown = fn`、`img.onload = fn` 这类写法一直无效。现在把宿主对象作为行内处理器宿主传入。
- **能力探测：把「探测不到」当成「不支持」（P1）**。`probeContext` 在缺少 `wx.createOffscreenCanvas` 时直接返回 `false`，导致支持 WebGL2 的模拟器/老基础库被误判。现在返回 `boolean | undefined`，并在上屏画布已解析后显式回退到第二次 `createCanvas()` 实测；仍无法判定才按基础库版本推断。
- **构建期：`typeof` 保护在 scope 未初始化时失效（P2）**。`typeof document` 曾因 `emptyScope` 抛错而崩溃，把本应永不抛错的运算符变成故障点。现在改写成 `typeof (__m3Has() ? __m3().document : undefined)`，runtime 未创建时得到 `'undefined'`，真实访问仍保留可读报错。

### Tests

- 用例从 32 增至 55：新增 `new` 表达式 / 对象简写 / `typeof` 守卫的改写边界用例，图片原生事件桥接（`onload`、`addEventListener`、`decode`、告警去重）用例，以及能力探测回退与 `webgl2Source` 用例。
- 对真实 `three@0.187` 产物验证：`three.module.js` 改写 16 处、`GLTFLoader.js` 改写 9 处，`new __m3().` 残留 0、简写语法错误残留 0，产物经 esbuild 解析通过。

## [0.1.1] - 2026-11-08

发布工程化：补齐 npm 元数据与发布检查流程，源码无行为变更。

### Added

- 发布准备：`package.json` 补充顶层 `types`、`./package.json` 导出、`publishConfig.access: public`。
- 新增 `clean`（清空 `dist/`）、`prepublishOnly`（发布前清理并跑 `npm run check`）与 `release:check`（`npm pack --dry-run --json`）脚本；`.gitignore` 忽略本地 `.tgz` 与 `.npmrc`。
- 新增 `scripts/clean.mjs`，避免历史 hash chunk 被带进发布包。
- `docs/09` 扩写完整的 npm 发布流程：账号与 2FA、包名检查、本地 tarball 演练、正式发布、发布后验证、版本迭代、CI 自动发布与其他分发方式。
- `README.md` 补充安装说明与 three / Node 版本要求。
- 补齐 `repository` / `homepage` / `bugs` 元数据，指向 GitHub 仓库。

### Changed

- 移除 `README.md` 中「包尚未发布到 npm 时」的条件说明，安装节只保留命令与版本要求。
- `examples/README.md` 改为以 npm 发布版本为默认，`workspace:*` 仅用于仓库内联调源码。

## [0.1.0] - 2026-11-08

首个可用版本。

### Added

- **运行时核心**：`MiniThreeScope`（显式、可逆、零全局污染）、`createRuntime()` / `MiniThreeRuntime` 单一生命周期、`PlatformBinding` 平台契约。
- **平台实现**：微信小游戏、微信小程序、浏览器（H5 双端 / Node 测试）三个 binding 与快捷入口。
- **就地画布补丁**：`patchElement` / `patchCanvas` + `Symbol.hasInstance` 注册表，WebGL2 上下文缓存、`getExtension` 归一化。
- **事件系统**：`PointerBridge` 多指状态机（pointerId、capture、pointercancel、tap 合成、document/window 冒泡）、W3C 迷你事件对象。
- **polyfill**：Blob/URL（对象 URL → data URI）、URL 相对解析、TextEncoder/Decoder、atob/btoa、fetch/XHR（`wx.request`）、AbortController、EventTarget。
- **构建插件**：Vite / Rollup 双入口，Babel AST 作用域精确重写、`three/webgpu` 策略、worker/wasm 资产收集与 `.wasm.br`、分包与 `game.json` 建议、`mini-three-assets.json` 与 `BuildReport`。
- **可观测性**：分级日志、`warnOnce`、能力报告 `runtime.report()`、构建报告 `plugin.api.report()`。
- **示例**：`examples/wechat-minigame`（含 game.json / project.config.json / postbuild）、`examples/wechat-miniprogram`（WXML 事件转发）、`examples/h5`。
- **测试**：32 个 Vitest 用例，覆盖 AST 重写、polyfill、运行时、插件与资产；可注入 `wx` 模拟器。
- **文档**：`AGENTS.md`、`llms.txt`、`docs/01`–`docs/11`、6 条 ADR、`docs/10-ai-playbook.md` 提示词库。

### Design decisions

- 显式可逆作用域，`installGlobals()` 作为可逆逃生舱（ADR-0001）。
- 单一 `createRuntime()` 生命周期与结构化 `PlatformBinding` 契约（ADR-0002）。
- AST 作用域分析只改写自由变量（ADR-0003）。
- 就地属性定义 + `Symbol.hasInstance`，不改原型（ADR-0004）。
- WebGL2 优先，能力探测不占用上屏画布；WebGPU 在小游戏不可用（ADR-0005）。
- 运行时零 `three` 依赖，构建与运行严格隔离（ADR-0006）。

### Notes

- 真机兼容矩阵与示例回归仍在进行中，见 `docs/11-compat-matrix.md`。
