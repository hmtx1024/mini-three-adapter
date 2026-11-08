# ADR-0005 · WebGL2 优先，不静默降级到 WebGL1

- 状态：Accepted
- 日期：2026-11-08
- 影响模块：`src/core/capabilities.ts`、`src/core/canvas.ts`、`src/core/dom.ts`、`src/platforms/wechat-common.ts`、`src/build/plugin-core.ts`

## 背景

- three.js r163 起 `WebGLRenderer` 不再支持 WebGL1（见 [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)）。
- 微信官方文档在 iOS 高性能+ 模式里明确「建议使用 WebGL2、内存压力大的游戏开启」（[iOS 高性能模式](https://developers.weixin.qq.com/minigame/dev/guide/game-engine/unity-webgl-transform/Design/iOSOptimization.html)）。
- 三方库里存在 `new WebGLRenderer()` 不传 canvas 的写法，此时 `document.createElement('canvas')` 产出的默认上下文类型直接决定渲染器能否创建。
- 宿主规定首次 `wx.createCanvas()` 是唯一上屏画布，能力探测不能碰它。
- 小游戏环境没有 WebGPU，而 three 的 `three/webgpu` 入口依赖 NodeMaterial / TSL，无法用重命名的方式退回 WebGL。

## 决策

1. `defaultContextType` 默认 `'webgl2'`；`document.createElement('canvas')` 优先 `wx.createOffscreenCanvas({ type: 'webgl2' })`，失败降级 2d **并告警**。
2. `probeContext()` 只用 `wx.createOffscreenCanvas()` 探测 WebGL2，探测后主动 `WEBGL_lose_context` 释放；绝不调用 `wx.createCanvas()`。
3. `capabilities.webgl2 === false` 时发出明确告警 + 能力报告，**不静默切到 WebGL1**。
4. WebGPU：插件对 `from 'three/webgpu'` 默认告警，`webgpu: 'rewrite'` 是有损的显式 opt-in。
5. 已知宿主 WebGL 差异（`getExtension` 返回数字、`drawingBufferWidth`）由 `normalizeWebGL: true` 显式修复，可关闭。

## 理由

- three 要求 WebGL2，静默降级只会把错误推迟到渲染阶段，不如在启动时给出可操作信息。
- 探测不占用上屏画布是硬性约束（ADR 不变量 #1）。
- 把「平台差异补丁」做成可开关、可观测，而不是在运行时改写渲染器行为。

## 后果

- 正面：启动即可诊断环境问题；与 three r163+ / 官方高性能+ 建议一致。
- 负面：极老设备 / 极旧基础库无法运行（明确不支持，见 `docs/11`）。
- 负面：WebGPU 生态项目必须改用 WebGL 构建目标（写进 `docs/05` / `docs/11`）。
- 风险：`createOffscreenCanvas({type:'webgl2'})` 在个别基础库上抛错 → `createOffscreenCanvasRaw()` 已带 catch 与降级日志。

## 被否决的备选方案

- 运行时自动检测 WebGL2 → 回退 WebGL1：three 不支持，否决。
- 用 `wx.createCanvas().getContext('webgl2')` 探测：会占用上屏画布，否决。
- 打包定制版 three 内核：违反「零 three 依赖 / 不 fork」边界，否决。

## 验证方式

`tests/runtime.test.ts` 覆盖 `getContext('webgl2')` 缓存与 `instanceof`；`docs/09` 真机清单要求 iOS/Android 各一台验证 WebGL2 出图。
