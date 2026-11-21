# ADR-0012 · 宿主数据属性不得用 defineProperty 接管

- 状态：Accepted
- 日期：2026-11-21
- 影响模块：`src/core/image.ts`（`createImageFactory` 的 src 分流、事件并行接线、src 轮询）

## 背景

真机探针（消消乐小游戏 2026-11-21 报告）确认 0.1.8 只修了第一层（ADR-0011）。第二层独立存在：

真机 `wx.createImage()` 返回对象的 `src` 读取为**可写数据属性**（`getOwnPropertyDescriptor` → `{ writable: true }`），但写入经由宿主的属性 interceptor 触发原生加载。`Object.defineProperty(raw, 'src', …)` 会把 interceptor 换成死的普通属性——即使随后用捕获的原描述符「还原」再写，写的也只是普通属性。0.1.5 引入、0.1.8 仍保留的「还原描述符→写一次→装回访问器」舞蹈因此从未在真机生效，一直只被普通对象的单测掩护。探针实测：真机 `branch: "data"`、1.2s 后 `width/height 0/0`、`complete: false`——图片根本没有开始加载。

同时，真机的 `addEventListener` 是**空壳**：接受注册、从不派发图片事件。旧代码 Tier-1（`addEventListener`）与 Tier-2（`onload`/`onerror` 槽位）是 else-if 互斥，Tier-1 挂上后槽位永远没接线——两条通道一条被替换、一条没接上。验证补丁（数据属性宿主不装 src 访问器 + 无条件挂槽位）真机出图正常。

## 决策

1. **`src` 按捕获描述符分流**：accessor（或无描述符）宿主照旧安装 shim 访问器（`mini-three-blob:` → `data:` 改写 + 兜底触发点不变）；**数据属性宿主完全不安装**，普通写入直达宿主 interceptor，原生加载钩子完好。
2. **禁止对宿主数据属性做 `defineProperty` 接管**——不只 `src`：任何「读取为数据属性、但写入/读取带原生语义」的宿主属性（`onprogress` / `ontimeupdate` / `onended` 等）同理。判断依据是描述符里的 `writable && !set`；「还原捕获的描述符」不是恢复原生的手段。
3. **事件通道并行接线**：`addEventListener` 与 `onload`/`onerror` 槽位都挂，不 else-if。`finish` 幂等（终态一次）保证双通道只收敛一次；watchdog 超时 `path` 报组合值（如 `addEventListener+onload`），超时能指认全部已挂通道。
4. **数据属性宿主的兜底由有界轮询驱动**：100ms 一次、120 次封顶（12s）侦测首次 `src` 写入后触发 `startFallback`（看门狗 / `wx.getImageInfo`）；终态（`finish`）或封顶自动停表。创建后从未赋值的图片不保留任何定时器。
5. 数据属性宿主读不了 `mini-three-blob:` 对象 URL：轮询检测到时 `warnOnce('image-src-object-url', …, { src })`，原生失败经槽位派发为 `error`（不再静默）。`createObjectURL` 落盘 `wx.env.USER_DATA_PATH` 的文件桥列为后续待办，不在本决策内。

## 理由

- ADR-0004（就地补丁）的细化：就地 `defineProperty` 适用于宿主**没有**的成员（补缺）或宿主自己就是 accessor 的槽位；对 interceptor 撑起的数据属性，defineProperty 是**替换**而不是补缺。
- 普通对象单测无法区分「写进普通属性」与「触发原生钩子」，真机语义必须显式建模——本仓库用 Proxy 复刻：数据描述符 + 写入副作用 + `defineProperty` 计数。
- 轮询优于报告建议的「1.2s 一次性探测」：对任意赋值时机都成立，且未用图片自动停表。

## 后果

- 正面：真机（数据属性 `src` + 空壳 `addEventListener` + 读属性槽位）出图；两层根因各有独立的单元宿主形态钉住。
- 负面：数据属性宿主上 `mini-three-blob:` 对象 URL 不再被改写为 `data:`——此前这类宿主**任何**图都加载不了，属于既有缺口显性化 + 指向性告警，非回归；GLTF 内嵌贴图在这类宿主上需要文件桥（待办）。
- 负面：轮询为每张图片保留一个 100ms 定时器直至首次写入或 12s 封顶；three 的 `ImageLoader` 在创建当帧赋值，实际开销 1–2 tick。
- 风险：若未来宿主在 `src` 上同时暴露 setter 描述符与 interceptor 语义，分流会走 accessor 分支——`writeNativeSrc` 用捕获的原生 setter 直写，仍然成立。

## 被否决的备选方案

- **沿用 0.1.5 的「还原描述符写一次」**：interceptor 宿主上写的是死属性（真机探针证实）。
- **报告建议的「1.2s 一次性探测 complete/width」**：只覆盖恰好落在该窗口内的赋值；轮询对任意时机成立且自动停表。
- **`createObjectURL` 落盘 USER_DATA_PATH**：需动 blob-url polyfill 与运行期文件清理（不变量 7），且数据属性宿主的 blob 缺口不是本次回归——列为待办。
- **方案 C（`canvas.createImage()` 优先）**：验证补丁证明 `wx.createImage()` 在 `src` 不被覆盖时真机可用，无需更换入口。

## 验证方式

- `tests/image-events.test.ts`：Proxy 宿主（数据描述符 + 写入副作用 + `defineProperty` 计数 + 空壳 `addEventListener` + 读属性槽位）端到端出图、`src` 永不被 defineProperty、轮询 + 组合 path 超时、双通道单次收敛、getImageInfo 经轮询、对象 URL 告警。
- 真机复测：业务侧升级 0.1.9，跑 `e59bf80` 构建对照，console 应无 `image-events-timeout` / `image-src-object-url`。
