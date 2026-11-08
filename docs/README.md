# 文档总索引

本目录是 `mini-three-adapter` 的**唯一权威文档源**。文档按「人读」与「AI 读」两类组织，全部为纯 Markdown，可直接作为大模型上下文。

## 推荐阅读顺序

| 顺序 | 文档 | 读者 | 目的 |
| --- | --- | --- | --- |
| 0 | [`../AGENTS.md`](../AGENTS.md) | **AI** | 不变量、命令、修改边界、评审清单 |
| 1 | [`../llms.txt`](../llms.txt) | **AI** | 全仓库文件索引与摘要（llms.txt 标准） |
| 2 | [01 设计目标与技术约束](./01-design-principles.md) | 人 / AI | 项目定位、环境约束、技术选型、能力边界 |
| 3 | [02 架构设计](./02-architecture.md) | 人 / AI | 分层、数据流、不变量 |
| 4 | [03 模块地图](./03-module-map.md) | **AI** | 改哪个文件、会影响谁 |
| 5 | [04 API 参考](./04-api-reference.md) | 人 / AI | 全部导出与签名 |
| 6 | [05 构建插件](./05-build-plugin.md) | 人 / AI | 编译期行为 |
| 7 | [06 平台差异与坑](./06-platform-notes.md) | 人 | 平台能力与已知问题 |
| 8 | [07 接入与集成指南](./07-integration-guide.md) | 人 | 从零接入现有项目 |
| 9 | [08 扩展指南](./08-extension-guide.md) | 人 / AI | 新增平台 / polyfill / 资源规则 |
| 10 | [09 测试与发布](./09-testing-and-release.md) | 人 | 命令与 CI |
| 11 | [10 AI 协作手册](./10-ai-playbook.md) | **AI** | 提示词模板与迭代工作流 |
| 12 | [11 兼容矩阵](./11-compat-matrix.md) | 人 / AI | 版本与能力边界 |
| 13 | [ADR](./adr/README.md) | 人 / AI | 每条关键决策的动机与后果 |

## 文档维护约定

1. **先读 `AGENTS.md` 的「架构不变量」**，任何改动不得破坏其中任意一条。
2. **任何行为变更必须同时更新** `docs/03-module-map.md`（若涉及文件职责变化）、`docs/04-api-reference.md`（若涉及导出）、`CHANGELOG.md`，并补一个 `tests/**/*.test.ts` 用例。
3. 文档编号即阅读顺序；新增文档时按主题插入并在本表、`README.md` 文档表、`llms.txt` 索引中同步登记。
4. 文档只描述本项目自身的结构与行为，保持自洽；外部规范链接集中放在 `01` 与 `06` 的对应小节。

## 文档与代码的对应关系

| 想了解 | 先看 |
| --- | --- |
| 某个源文件该不该改 | [03 模块地图](./03-module-map.md) |
| 某个 API 怎么调用 | [04 API 参考](./04-api-reference.md) |
| 为什么生成 `__m3()` / 资产去哪了 | [05 构建插件](./05-build-plugin.md) |
| 为什么这样分层 | [02 架构设计](./02-architecture.md) 与 [ADR](./adr/README.md) |
| 怎么把适配层装进项目 | [07 接入与集成指南](./07-integration-guide.md) |
| 怎么发布到 npm | [09 测试与发布](./09-testing-and-release.md#95-发布到-npm) |
| 用 AI 改代码时怎么提问 | [10 AI 协作手册](./10-ai-playbook.md) |
