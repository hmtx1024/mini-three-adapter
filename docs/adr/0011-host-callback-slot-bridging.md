# ADR-0011 · 宿主回调槽位的访问器不得遮蔽桥接

- 状态：Accepted
- 日期：2026-11-21
- 影响模块：`src/core/image.ts`（`createImageFactory`）；受约束于 `src/polyfills/event.ts`（`MiniEventTarget.dispatchEvent` 的行内派发）

## 背景

0.1.5 起图片事件桥接采用四级兜底：转发器 `forwardLoad` / `forwardError` 在 shim 访问器安装**之前**写入宿主的原生 `onload` / `onerror` 槽位；随后安装的用户访问器把同一属性覆盖成登记表——getter 返回 `handlers[eventName]`，只有消费者显式 `img.onload = fn` 才有值。

2026-11-21 业务侧真机对照报告（消消乐小游戏 `docs/adapter-image-events.md`）证实：真机宿主**不消费赋值时存下的回调**，而是在图片完成那一刻**读 `image.onload` 属性并调用读到的值**。three 的 `ImageLoader` 只用 `addEventListener('load')`、从不赋 `onload`，宿主读到 `undefined` → 桥接永不执行 → 2s 看门狗判 `image-events-timeout` → 所有 `TextureLoader` 纹理 reject（启动页插图 / UI 位图全部空白，且无报错）。模拟器的 `wx.createImage()` 在**赋值那一刻**把回调存进宿主内部、事件时直接调用存值，不读属性——同一份产物模拟器正常，缺陷被掩盖两个版本。

## 决策

安装在宿主回调槽位（`onload` / `onerror`）上的访问器遵循四条硬规则：

1. **非派发期间，getter 永远返回可调用的桥接函数**（`forwardLoad` / `forwardError`），不返回登记表。宿主「读属性再调用」的形态因此总能触发 `finish`；`finish` 幂等（终态只派发一次），宿主「既存又读」也不会双发。
2. **派发期间（`dispatchDepth > 0`），getter 返回登记的用户回调**。`MiniEventTarget.dispatchEvent` 的行内派发读 `host['on' + type]`：此时必须回用户函数，否则行内派发会递归回桥接而不是调用业务回调。
3. 登记照旧只进 `handlers`；setter **不**向宿主原生槽位写入用户函数——宿主若直接调存值就绕过了 `finish`，终态不落、看门狗 2s 后会迟到误判。
4. 转发器写入原生槽位必须发生在访问器安装**之前**（现有顺序：Tier-2 裸赋值 → 访问器）。这条依赖 `patchElement` 不碰 `on*` 成员；若未来 `patchElement` 开始定义 `on*`，本桥必须改为用 `patchElement` 之前抓到的描述符写值。

## 理由

- 对象身份不变（ADR-0004）：继续 `Object.defineProperty` 就地补丁，不 Proxy、不改原型。
- 单一派发路径：用户回调只经 `dispatchEvent` 的行内派发送达，桥接只负责终态与监听器派发；双路触发收敛到一次。
- 业务报告的「组合 getter」（`user ? (ev) => { bridge(ev); user(ev) } : bridge`）会双发：`finish` 的行内派发再次读到组合函数并再次调用 user。`dispatchDepth` 区分两种读者，比组合更简单且各只送达一次。

## 后果

- 正面：真机「读属性」宿主出图；看门狗超时补 `warnOnce('image-events-timeout', …, { path, src })`，真机排查不再「无报错」。
- 负面：`img.onload === fn` 的身份比较不再成立（getter 回桥接而非用户函数）——浏览器语义在此让位于可交付性，已知代价；仓库内与 three 均无此类消费方。
- 负面：第三方若**读** `img.onload` 并自行调用，会触发一次完整派发（终态 + 监听器 + 用户回调），而非仅用户回调——语义上等价于「宿主触发了事件」。
- 风险：若未来有代码在派发进行中从外部读 `img.onload`，会读到用户回调而非桥接；当前无此读者。

## 被否决的备选方案

- **组合 getter（报告方案 A 草稿）**：行内派发再次读到组合函数，用户回调双发。
- **getter 恒回登记表（0.1.7 现状）**：真机读到 `undefined`，P0。
- **getter 恒回用户回调**：宿主直调用户函数、绕过 `finish`，看门狗 2s 后迟到报 error，`decode()` 永不 settle。
- **报告方案 B（统一事件源）/ C（`canvas.createImage()` 优先）**：与遮蔽缺陷正交，留待后续；本 ADR 只锁「访问器语义」这一层。

## 验证方式

- `tests/image-events.test.ts`：「触发时读属性」宿主 ×3（桥接可达 `addEventListener` 消费者 / 槽位始终可调用 / 业务 `img.onload = fn` 恰好一次）、「既存又读」宿主只收敛一次、看门狗超时告警恰好一条（带 `path` / `src`）。
- 真机复测路径：业务仓库切 `e59bf80` 构建对照（修复前模拟器正常 ↔ 真机空白；修复后均正常），见报告「五分钟确诊」。
