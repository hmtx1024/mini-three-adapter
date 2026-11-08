# 贡献指南

## 开始之前

1. 读 [`AGENTS.md`](./AGENTS.md)（架构不变量与命令）和 [`docs/03-module-map.md`](./docs/03-module-map.md)。
2. 跑 `npm install && npm run check`，确认基线全绿。
3. 大改动（新平台、公开 API 变化、架构不变量变化）先开 issue / 写 ADR，再写代码。

## 开发循环

```bash
npm test -- --watch   # TDD：先写失败用例
npm run typecheck
npm run build
npm run check         # 提交前
```

## 提交规范

- 标题用 `type: 简述`，例如 `fix(pointer): 修正 touchend 后 pointerId 未清理`。
- type：`feat` / `fix` / `docs` / `test` / `refactor` / `build` / `chore`。
- 每个 PR 必须包含：代码、测试、相关文档更新、`CHANGELOG.md` 条目。

## 必须同步更新的文档

| 改动类型 | 需要更新 |
| --- | --- |
| 新增/修改导出 | `docs/04-api-reference.md`、`src/index.ts` 或子路径 index、`package.json exports` |
| 文件职责变化 | `docs/03-module-map.md` |
| 平台能力变化 | `docs/11-compat-matrix.md`、`docs/06-platform-notes.md` |
| 构建插件行为 | `docs/05-build-plugin.md`、`docs/09-testing-and-release.md` |
| 接入方式变化 | `docs/07-integration-guide.md`、`examples/` |
| 破坏架构不变量 | 新增 `docs/adr/NNNN-*.md`，旧 ADR 标 Superseded |
| 任何行为变化 | `CHANGELOG.md` |

## 代码审查重点

- 是否违反 `AGENTS.md` 的 10 条不变量？
- 是否有测试覆盖，且测试不依赖真实 `wx` / 真实浏览器？
- 新增订阅、定时器、全局写入是否在 `dispose()` 中被还原？
- 是否引入了 `three` 的运行时 import、或把 `node:fs` 带到运行时？
- AST 改写是否仍只针对自由变量？
- 文档索引（`docs/README.md`、`README.md`、`llms.txt`）是否与文件树一致？

## 许可

新增代码默认 MIT，见 [`LICENSE`](./LICENSE)。
