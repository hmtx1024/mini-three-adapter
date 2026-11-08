# ADR-0006 · 运行时零 `three` 依赖，构建 / 运行严格隔离

- 状态：Accepted
- 日期：2026-11-08
- 影响模块：`package.json`、`tsup.config.ts`、`src/**`、`docs/03-module-map.md`

## 背景

适配层如果与某个具体的 three 版本绑定（打包内置 three、替换 three 内部模块、改写渲染器方法），three 升级就必须同步发布适配层，行为也变得难以预测。

另一方面，构建插件运行在 Node，运行时代码运行在 JS 引擎。两者若混在同一个 bundle 里，`node:fs` 之类的依赖会被带进小游戏代码包，既增大体积又破坏可移植性。

## 决策

1. `src/**` **不得 import `three`**；`three` 只是 `optional peerDependency`，且被 tsup 标为 `external`。
2. 运行时只实现「浏览器环境 shim」，不关心 three 的类、材质、渲染流程。
3. 所有 three 相关的构建期行为集中在 `src/build/**`，且只做三件事：AST 全局重写、WebGPU 策略、worker/wasm 资产收集；**不改写 three 源码语义**。
4. 依赖方向固定：`types → scope/polyfills → core → platforms`；`build` 是独立分支，不得 import `core`/`platforms`；`node:fs` 只允许出现在 `build/`。
5. tsup 两套构建：runtime = `es2019` / `platform: neutral` / splitting / dts；build tooling = `node18` / `platform: node` / 不 splitting。
6. `es2019` 目标让 esbuild 降级 `?.` / `??`，减少微信开发者工具语法报错。

## 理由

- 适配层与 three 解耦后，three 从 r163 到 r18x 的升级不需要改适配层内核，只需按 `docs/11` 补全局清单 / DOM 属性。
- 构建/运行隔离保证产物体积与可移植性；也便于在 Node 里跑单元测试。
- 不做语义改写 → 行为可预测、可调试，不会在 three 升级后突然失效。

## 后果

- 正面：包体小、版本兼容面宽、可测试、可 tree-shake。
- 负面：某些 loader 的 worker/wasm 需要业务自行 `setDecoderPath()`；插件只负责把资源放进包并生成 manifest。
- 负面：不提供「自动替换 addons 模块」的便利，接入时按 `docs/07` 配置 decoder 路径即可。
- 风险：未来 three 引入依赖原生 Web API 的新模块时，需要按 `docs/08` 补 polyfill（这是常规迭代，不是架构变更）。

## 被否决的备选方案

- fork / 打包 three：体积、版本、许可都不可接受，否决。
- 运行时 monkey-patch `WebGLRenderer`：隐式、脆弱、不可观测，否决。
- 把插件与运行时打成一个包入口：`node:fs` 会进小游戏 bundle，否决。

## 验证方式

`npx tsc --noEmit` + `npx tsup` 产物检查（`dist/index.js` 不含 `node:` 导入）；`tests/*` 全程在 Node 中用 mock `wx` 运行，不加载真实 three。
