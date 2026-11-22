# ADR-0013 · 对象 URL 直接返回 data: URI

- 状态：Accepted
- 日期：2026-11-22
- 影响模块：`src/polyfills/blob-url.ts`、`src/core/image.ts`

## 背景

0.1.9 把「`src` 为原生数据属性」的真机宿主改为完全直通（ADR-0012）后，对象 URL 成为该类宿主唯一读不了的东西：旧的 `mini-three-blob:<id>` 注册表依赖「写入 `img.src` 时改写为 `data:`」，而直通宿主没有改写点，原生 loader 收到 `mini-three-blob:...` 直接失败。P2 待办最初拟定的方案是「`createObjectURL` 落盘 `wx.env.USER_DATA_PATH` 返回文件路径」。

重估后发现该方案与 web 契约冲突：`URL.createObjectURL` 必须**同步**返回字符串，而 `writeFile` 是异步的——GLTFLoader 拿到返回值后立即赋给 `img.src`，文件未写完就加载，属于同一类「模拟器正常、真机间歇失败」的缺陷；还要额外承担临时文件清理、配额、扩展名嗅探与 polyfill 边界（polyfills 不得读 `globalThis.wx`）。

关键事实：项目最初的设计表述就是「对象 URL → `data:` URI，宿主图片加载器可直接识别，无需拦截 `Image.src`」（[docs/01](../01-design-principles.md)），只是实现后来演化成了注册表 + 写入时改写。

## 决策

1. `MiniURL.createObjectURL(blob)` **同步返回 `blob.dataURL()`**，即 `data:<mime>;base64,...`；不再产生 `mini-three-blob:` 句柄，不再维护注册表。
2. `revokeObjectURL` 为 no-op（API 兼容保留）；`resolveObjectURL` 恒返回 `null`；`clearObjectURLs` 为 no-op；`OBJECT_URL_PREFIX` 保留导出并标记 deprecated。
3. `image.ts` 删除 `resolveSrc` 与对 `MiniURL` 的依赖；0.1.9 的 `image-src-object-url` 告警与相关分支删除。
4. watchdog 告警 payload 的 `src` 对长 `data:` URI 截断描述（`data:image/png;base64,…(1772874 chars)`）。
5. 不做尺寸阈值/混合落盘：真机探针覆盖到 1.77 MB URI，未出现解码失败；超大内嵌贴图的生产建议仍是「外部化纹理」。

## 理由

- **同步契约**：`data:` 在 `createObjectURL` 返回的同一 tick 就可用，与浏览器 `blob:` 的同步语义一致；文件落盘做不到。
- **零生命周期**：没有临时文件、没有清理、没有配额、没有注册表；顺带消除「未被 revoke 的 `MiniBlob` 常驻」的既有泄漏。
- **统一宿主**：`data:` 是字符串本身，accessor 宿主与数据属性宿主走出完全相同的路径，`src` 拦截不再是对象 URL 的前提。
- **真机证据**（Android / 基础库 3.18.0）：1×1 PNG 169ms、1080×1912 JPEG（142 KB URI）164ms、256×256 PNG（198 KB URI）149ms、768×768 PNG（**1.77 MB URI**）174ms，全部 `onload` 成功。

## 后果

- 正面：数据属性宿主可加载 GLTF 内嵌贴图；`createObjectURL` 与 docs/01 的原始设计重新一致；对象 URL 相关的代码与时序分支更少。
- 负面：`data:` 在 `createObjectURL` 那一刻就 eager 编码（base64 是同步 CPU + 字符串内存）。three 的 loaders 都是 create→load 紧邻，等价于旧的「写入时编码」；但持有对象 URL 一段时间再用的代码会提前付出内存。
- 负面：`revokeObjectURL` 不再使 URL 失效（浏览器语义差异）。实践中没有依赖者（three 的 loaders 亦不保证 revoke）。
- 风险：超大内嵌贴图（数十 MB）会生成超大字符串，内存峰值取决于设备；生产建议外部化纹理，并可在业务侧预压缩。

## 被否决的备选方案

- **注册表 + 写入 `src` 时改写（0.1.4–0.1.9）**：依赖 `src` 拦截，直通宿主没有改写点。
- **`createObjectURL` 落盘文件（原 P2 待办）**：异步写违反同步契约（竞态）、生命周期与配额成本、跨 polyfill 边界。
- **阈值混合（小图 `data:`、大图落盘）**：真机探针未发现尺寸失败，先不引入两套语义；需要时再作为增补。
- **轮询检测到 `mini-three-blob:` 再改写 src**：会与原生首次失败事件竞争，可能先派发 error 终态。

## 验证方式

- `tests/polyfills.test.ts`：`createObjectURL` 返回可加载的 `data:`；`resolveObjectURL` 恒 `null`；revoke no-op。
- `tests/image-events.test.ts`：「对象 URL 是 `data:`，数据属性宿主直通加载」。
- 真机探针记录：Android / 基础库 3.18.0，四个尺寸全部出图（见上）。
