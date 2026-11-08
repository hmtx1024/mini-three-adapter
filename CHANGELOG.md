# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [Unreleased]

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
