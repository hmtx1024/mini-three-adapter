# ADR-0007 · 能力探测允许「主画布回退」与「无法探测」语义

- 状态：Accepted
- 日期：2026-11-10
- 影响模块：`src/core/capabilities.ts`、`src/platforms/wechat-common.ts`、`src/platforms/wechat-game.ts`、`src/platforms/wechat-miniprogram.ts`、`src/types.ts`

## 背景

架构不变量之一是「只有一个上屏画布」，能力探测因此被限定为**只能**用 `wx.createOffscreenCanvas()`，绝不调用 `wx.createCanvas()`。

实际开发中暴露了两个问题：

1. **被探测对象 ≠ 被使用对象。** 上屏画布支持 WebGL2，离屏画布不支持（或 `createOffscreenCanvas` 根本不存在），是微信各基础库 / 机型的常态。微信开发者工具 3.18.0 模拟器就是这种情况：`capabilities.webgl2 === false`，但 three 的 `WebGLRenderer` 用 `#version 300 es` 正常渲染。
2. **「探测不到」被当成了「不支持」。** `probeContext` 第一个分支直接 `return false`，于是「这个宿主没提供探测手段」被写成了「这个宿主没有 WebGL2」。宿主若据此降级后端或画质，就会在支持 WebGL2 的设备上错误降级，排查色彩 / 精度问题时也会被带偏。

## 决策

1. `probeContext` 返回 `boolean | undefined`：
   - `true` / `false` 表示**实测结果**；
   - `undefined` 表示**无法探测**。
2. 探测顺序：离屏实测 → （仅当调用方显式允许时）第二次 `wx.createCanvas()` 实测 → 仍无法判定则返回 `undefined`。
3. `detectCapabilities` 把 `undefined` 当作未知，退回基础库版本启发式（`>= 2.20.0`），并用新增的 `capabilities.webgl2Source`（`'probe' | 'inferred' | 'override'`）标明来源；此时 `warnOnce` 提示一次。

## 理由

- 第二次 `wx.createCanvas()` 在微信里**保证**得到离屏画布（上屏画布只有第一次调用才返回），这与 `createOffscreenCanvasRaw` 里已有的兜底是同一机制，不违反「只有一个上屏画布」的本意：本意是**不要抢走那块上屏画布**，而不是禁用该 API。
- 因此回退**必须**在上屏画布已经解析之后调用，并且由调用方显式 opt-in（`allowCanvasFallback`）。`wechat-game` 的 `getScreenCanvas()` 就在探测之前，所以传 `true`；`wechat-miniprogram` 的画布节点来自选择器查询，不能这样探测，保持不传。
- `webgl2Source` 让「这份报告里的 `false` 到底是实测还是猜测」一眼可见，这是本次缺陷里最伤排查成本的部分。

## 后果

正面：

- 模拟器 / 老基础库上不再把支持 WebGL2 的主画布误判为不支持；
- 能力报告自带来源，宿主可以据此选择「信任」或「自己覆盖」。

负面 / 风险：

- 回退分支会多创建一个 1×1 画布（仅在离屏探测失败时发生），计入画布数量；
- `'inferred'` 仍然是猜测。若宿主真的不支持 WebGL2 而基础库版本又较新，报告会偏乐观——但 three r163+ 自身会在创建上下文时明确失败，比静默降级更容易发现；
- `probeContext` 的返回类型从 `boolean` 放宽为 `boolean | undefined`，属于**类型放宽**：既有 `(type) => boolean` 的实现仍然可赋值。

## 被否决的备选方案

| 方案 | 否决理由 |
| --- | --- |
| 继续只用离屏探测 | 就是本次缺陷本身 |
| 直接探测上屏画布 `getContext('webgl2')` | 会用默认属性抢先创建真实 GL 上下文，three 之后再带 `antialias` 等属性请求会拿到同一个上下文，渲染属性被静默改变 |
| 把 `webgl2` 改成 `boolean \| null` | 破坏公开字段语义，所有读取处都要改；用 `webgl2Source` 附加信息可达到同样诊断效果 |
| 探测不到就一律当 `false` | 会把未知伪装成结论，正是要修的问题 |

## 验证方式

- `tests/capabilities.test.ts`：离屏优先且不碰 `createCanvas`、离屏不可用时回退、离屏返回 false 而主画布返回 true、完全无法探测时返回 `undefined`、`webgl2Source` 三种取值。
- `tests/runtime.test.ts`：小游戏运行时能力报告仍包含 `wechat-game` 与 `WebGL2`。
