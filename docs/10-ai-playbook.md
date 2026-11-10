# 10 · AI 协作手册

> 目标：让后续任何一次「用 AI 优化 / 迭代适配层」都能在**最小上下文**下做出正确改动。本文件本身可以直接作为系统提示词的一部分。

## 10.1 上下文装载顺序（每次会话先做）

1. `AGENTS.md` — 架构不变量、命令、修改边界。
2. `llms.txt` — 全仓库文件索引与一句话摘要。
3. `docs/03-module-map.md` — 定位要改的文件与下游影响。
4. `docs/02-architecture.md#25-架构不变量` — 不得破坏的 10 条规则。
5. 相关 ADR（`docs/adr/`）— 理解「为什么这样」。
6. 只读取**目标文件 + 其直接依赖**，不要一次性把整个 `src/` 塞进上下文。
7. 需要确认平台行为时，读 `docs/06-platform-notes.md`；需要确认能力边界时，读 `docs/11-compat-matrix.md`。

## 10.2 让 AI 先回答的三个问题（防止瞎改）

在动手前要求模型输出：

```
1. 这次改动涉及哪些模块？（列出文件路径）
2. 是否触碰 docs/02 中的任意一条架构不变量？哪一条？
3. 需要新增/修改哪些测试？验收断言是什么？
```

如果第 2 题答「是」但无法给出 ADR，先写 ADR，再改代码。

## 10.3 任务型提示词模板

### A. 修复「three 报 xxx is not defined」

```
上下文：AGENTS.md、docs/03-module-map.md、src/build/scope-rewrite.ts、src/scope.ts、src/core/runtime.ts
任务：three@<版本> 在 <场景> 报错 "<错误信息>"。
请：
1) 判断缺失的是「全局标识符」还是「DOM 属性」还是「构造器」；
2) 按 docs/08 的对应小节做最小改动；
3) 在 tests/ 里补一个复现用例，先让它失败再修复；
4) 更新 docs/03 / docs/04 / CHANGELOG.md；
5) 运行 npm run check，贴出结果。
约束：不得 import three；不得写 globalThis；不得使用字符串全局替换。
```

### B. 新增平台

```
上下文：docs/08#81-新增一个平台、src/core/platform.ts、src/platforms/wechat-game.ts、src/platforms/wx-types.ts
任务：新增 <平台名> 支持。
按 docs/08 的 7 步执行，产出：
- 新平台文件 + 导出 + package.json exports
- Capabilities 字面量与 docs/11 登记
- 独立测试文件（用可注入的 mock 宿主）
- examples/<platform>/ 最小示例
验收：npm run check 全绿；dispose() 后无残留监听；不调用 wx.createCanvas() 超过一次。
```

### C. 升级 three 大版本

```
上下文：docs/11-compat-matrix.md、docs/01-design-principles.md、src/build/scope-rewrite.ts、src/core/element.ts
任务：适配 three r<版本>。
请：
1) 从官方 Migration Guide 列出该版本新增/移除的全局与 DOM 依赖；
2) 对照 DEFAULT_GLOBAL_NAMES 与 patchElement 属性表，列出差异；
3) 逐项补实现 + 测试；
4) 检查 three/addons vs three/examples/jsm 路径、WebGPU 入口、outputColorSpace；
5) 更新兼容矩阵与 CHANGELOG。
```

### D. 性能 / 包体优化

```
上下文：docs/05、docs/06#65、src/build/assets.ts、examples/wechat-minigame/vite.config.ts
任务：把首包体积降低到 <N>MB。
请给出：
- plugin.api.report() 的基线数据
- manualChunks / 分包 / Brotli / worker 目录的具体配置 diff
- 每项措施的验证方式与回退方案
禁止：静默删除资源、隐式改写 WebGLRenderer、破坏 worker 单目录约束。
```

### E. 回归一个 three 官方示例场景

```
上下文：examples/wechat-minigame/、docs/11-compat-matrix.md、docs/08-extension-guide.md
任务：选取一个 three 官方示例场景 <exampleId>（controls / loaders / postprocessing 类别），
      用 examples/wechat-minigame 的入口与构建配置接入并跑通。
记录到 docs/11-compat-matrix.md：three 版本、基础库、设备、结果、失败原因、所需 polyfill。
```

## 10.4 AI 输出的自检清单（要求模型逐条确认）

- [ ] 没有新增对 `three` 的运行时 import。
- [ ] 没有 `new Proxy(canvas)` / `Object.setPrototypeOf` / 克隆画布。
- [ ] 没有第二次 `wx.createCanvas()`。
- [ ] 所有新增订阅/定时器/全局写入都登记到 `disposers`。
- [ ] 构建插件的新行为有开关，默认不改变既有语义。
- [ ] AST 改写仍通过 `path.scope.hasBinding(name, true)`。
- [ ] 新增导出已同步到 `src/index.ts` 或对应 `core/index.ts`、`package.json exports`、`docs/04`。
- [ ] 新增/修改的测试通过，且 `npm run check` 全绿。
- [ ] `CHANGELOG.md`、`docs/03`（若职责变化）、`docs/11`（若能力变化）已更新。

## 10.5 常见 AI 反模式（明确禁止）

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 「直接在 `globalThis` 上补一个 `window` 就好了」 | 破坏零全局污染与 H5 双端 | `scope` + `installGlobals()` 可逆注入 |
| 「用正则把 `window` 全替换成 `__m3().window`」 | 误伤局部变量、字符串、对象键 | Babel `ReferencedIdentifier` + scope 判定 |
| 「新建一个 `class HTMLCanvasElement` 包装 wx canvas」 | 微信内部 WeakMap 按对象身份校验 | 就地 `defineProperty` + `Symbol.hasInstance` |
| 「在运行时把 `WebGLRenderer.render` 猴补丁一下清深度」 | 隐式、不可观测、与 three 版本强耦合 | 应用层显式 `renderer.clearDepth()`，写进文档 |
| 「把 three 一起打包进适配层省事」 | 体积、版本冲突、许可 | `three` 保持 optional peer + external |
| 「WebGPU 不支持就 `try/catch` 回退」 | 小游戏根本没有 WebGPU 且 NodeMaterial 无 WebGL 等价物 | 插件 `webgpu` 策略 + 使用 WebGL 构建目标 |
| 「能力探测时直接 `wx.createCanvas().getContext('webgl2')`」 | 偷走唯一上屏画布、且用默认属性抢先建上下文 | 用 `wx.createOffscreenCanvas()`；仅按 ADR-0007 显式回退 |

## 10.6 机器可读的报告（给自动化 / CI 用）

- 运行期：`runtime.report()` → 能力报告文本。
- 运行期：`runtime.capabilities` → 结构化对象。
- 构建期：`plugin.api.report()` → `BuildReport`（模块数、改写数、缺失资源、解析失败、WebGPU 告警）。
- 构建期：`mini-three-assets.json` → 资源清单 + `game.json` 建议 + 构建报告。
- 项目级：`AGENTS.md` / `llms.txt` / `docs/03-module-map.md` 作为上下文索引。

建议把 `parseFailures.length === 0` 与 `missingAssets` 白名单作为 CI 门禁；把 `report()` 附在 bug issue 模板里，便于 AI 直接定位环境差异。

## 10.7 一次迭代的标准工作流

```
读 AGENTS.md / llms.txt / docs/03
   ↓
用 §10.2 三问确认边界 → 必要时写 ADR
   ↓
写失败测试（tests/*.test.ts，用 createMockWx）
   ↓
最小实现（只改 docs/03 指向的文件）
   ↓
npm run check（typecheck + 32+ 测试 + tsup）
   ↓
更新 docs/03 / docs/04 / docs/11 / CHANGELOG.md
   ↓
真机验收（docs/09 清单）→ 更新 docs/11 兼容矩阵
```
