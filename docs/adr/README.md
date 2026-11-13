# 架构决策记录（ADR）

每条 ADR 记录一个**难以从代码本身看出原因**的决策。新增或推翻决策时不要删除旧文件，把状态改为 `Superseded by ADR-XXXX` 并写明原因——这是给后续 AI 迭代保留「为什么」的关键。

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| [0001](./0001-scoped-globals.md) | 作用域化的浏览器环境 shim | Accepted |
| [0002](./0002-unified-runtime-lifecycle.md) | 单一 `createRuntime()` / `MiniThreeRuntime` 生命周期 | Accepted |
| [0003](./0003-ast-rewrite.md) | 用 Babel AST 作用域分析重写三方模块全局引用 | Accepted |
| [0004](./0004-in-place-patching.md) | 就地 patch 画布，不改原型、不用 Proxy | Accepted |
| [0005](./0005-webgl2-only.md) | WebGL2 优先，不静默降级到 WebGL1 | Accepted |
| [0006](./0006-zero-three-dependency.md) | 运行时零 `three` 依赖，构建/运行严格隔离 | Accepted |
| [0007](./0007-capability-probe-fallback.md) | 能力探测允许主画布回退，`undefined` 表示「无法探测」 | Accepted（部分被 0008 收紧） |
| [0008](./0008-probe-fallback-boundary.md) | 无离屏 API 不兜底；身份基准取候选上屏画布全集 | Accepted |
| [0009](./0009-placeholder-scope-environment-globals.md) | 占位作用域的环境全局读作 `undefined`，早读改为启动时点名 | Accepted |
| [0010](./0010-native-event-target-boundary.md) | 原生事件目标不做 EventTarget 替换，`patchElement` 改为补缺不覆盖 | Accepted |

模板（新增 ADR 时复制）：

```markdown
# ADR-NNNN · 标题
- 状态：Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- 日期：YYYY-MM-DD
- 影响模块：...

## 背景
## 决策
## 理由
## 后果（正面 / 负面 / 风险）
## 被否决的备选方案
## 验证方式
```
