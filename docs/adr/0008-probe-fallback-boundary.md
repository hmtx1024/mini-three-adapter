# ADR-0008 · 能力探测兜底的边界：无离屏 API 不兜底，身份基准取候选全集

- 状态：Accepted（收紧 [ADR-0007](./0007-capability-probe-fallback.md) 的两条判据）
- 日期：2026-11-10
- 影响模块：`src/platforms/wechat-common.ts`、`src/platforms/wechat-game.ts`

## 背景

[ADR-0007](./0007-capability-probe-fallback.md) 允许在离屏探测答不出时回退到第二次 `wx.createCanvas()`，并用「上屏画布引用 + 身份比对」挡住最危险的一种返回。上线后复核发现两道口子：

1. **缺 `createOffscreenCanvas` 时仍然兜底。** 这条路径拿到的是「第几次 `createCanvas()`」的猜测：宿主若预置了 `GameGlobal.screencanvas`，首次调用根本没有被消耗，回退拿到的就是上屏画布本身。兜底换来的只是一个能力布尔值，代价却是可能被 `getContext` + `WEBGL_lose_context` 一起废掉的上屏上下文——症状是黑屏且不报错。
2. **身份比对基准选错了对象。** 原实现比的是「本次实际使用的画布」（`rawCanvas`）。宿主如果既预置了 `GameGlobal.screencanvas`、又调 `createWeChatGameBinding({ canvas })` 传了自己的画布，`getScreenCanvas` 走 `supplied` 分支、不写缓存，`rawCanvas` 与预置画布不是同一个对象，比对必然落空，探测照样摸到上屏画布。

## 决策

1. **没有 `createOffscreenCanvas` 就完全不兜底**。`allowCanvasFallback` 只在离屏 API 存在时生效；API 缺失直接返回 `undefined`，由 `detectCapabilities` 按基础库版本推断并标记 `webgl2Source: 'inferred'`。
2. **身份比对基准从「一个画布」改为「候选全集」**：`ProbeContextOptions.screenCanvas` 改为 `reservedCanvases`，小游戏绑定传入 `getScreenCanvas` 期间全部可能成为上屏画布的对象——显式传入的画布、缓存的上屏画布、`GameGlobal.screencanvas`、`globalThis.canvas`。命中任一即放弃探测。
3. 兜底仍然要求「上屏画布已解析」且显式 opt-in，这两条不变。

## 理由

- 兜底的价值是「一个更准的能力布尔值」，风险是「整块上屏画布」。ADR-0007 的收益判断在离屏 API 存在时成立（此时至少知道探测目标是第二次调用），在 API 缺失时不成立：那时连"这是第几次调用"都无法确定，等同掷硬币。**用「探测不到」换「确定不炸」是划算的**，何况不确定性已经通过 `webgl2Source: 'inferred'` 显式暴露给调用方，宿主可以自己覆盖。
- 身份比对是唯一可靠的判据，而"判据对不对"取决于基准集合是否完整。把一个引用扩成候选全集，成本是一次四元素的数组构造，收益是关掉一个入口分支上的重后果漏洞。
- 采纳「候选全集」而不是"禁止 `supplied` 与 `screencanvas` 同时出现"，是因为后者会让宿主为了探测安全而改变合法的初始化写法。

## 后果

正面：

- 老基础库（无 `createOffscreenCanvas`）上不再有「探测废掉上屏画布」的路径；
- 显式传 `canvas` 的宿主也受身份守卫保护，`GameGlobal.screencanvas` 预置 + 自定义画布的组合不再漏；
- 回退分支少创建一块 1×1 画布，省一次画布额度。

负面 / 风险：

- 无离屏 API 的设备上不再有实测值，`webgl2` 完全依赖基础库版本推断（`>= 2.20.0`）。报告里 `webgl2Source: 'inferred'` 与一次 `warnOnce` 会说明这一点；
- 候选全集仍不是数学意义上的全集：如果某个宿主的上屏画布既不在 `GameGlobal.screencanvas`、也不在 `globalThis.canvas`、也没有显式传入，而 `createCanvas()` 又把它交回来，身份守卫仍会漏。这种宿主无法从适配层可见的信息中识别，属于残余风险；缓解手段是开发者工具 / 真机回归（`docs/11`）。

## 被否决的备选方案

| 方案 | 否决理由 |
| --- | --- |
| 保留无离屏 API 时的兜底，只做身份比对 | 正是本次要关掉的口子：那时连基准集合都不可靠 |
| 干脆彻底删掉回退探测 | 会丢掉 ADR-0007 的核心收益（开发者工具 / 部分机型离屏不支持 WebGL2，主画布支持），能力报告退回纯版本推断 |
| 禁止同时传 `canvas` 与预置 `screencanvas` | 用 API 限制去补实现漏洞，宿主合法写法被迫改变 |
| 用 `instanceof` / 宽高特征识别上屏画布 | 不是可靠判据（离屏画布同样有宽高），误判代价同样是黑屏 |

## 验证方式

- `tests/capabilities.test.ts`：
  - 无 `createOffscreenCanvas` 时 `createCanvas()` 零调用、返回 `undefined`；
  - 离屏存在但答不出 WebGL2 时仍回退，且回退返回非候选画布时正常得到 `true`；
  - 回退返回候选画布时不 `getContext`；
  - `GameGlobal.screencanvas` 预置 + 显式 `canvas` 时上屏画布零触碰、`webgl2Source === 'inferred'`；
  - 离屏存在、回退拿到预置的上屏画布时同样零触碰。
- `tests/runtime.test.ts`：正常路径的能力报告不受影响。
