# AGENTS.md · AI 协作约束

> 本文件是**给 AI 编码助手的第一入口**。任何自动修改前先读完本文，再按 [`docs/10-ai-playbook.md`](./docs/10-ai-playbook.md#101-上下文装载顺序每次会话先做) 装载最小上下文。

## 项目一句话

`mini-three-adapter` 是一个 TypeScript 编写、ESM、零全局污染的 **微信小游戏 / 小程序 Three.js 适配层**：构建期用 AST 把三方模块的浏览器全局引用重定向到作用域对象，运行期用 `PlatformBinding` 把 `wx` 的原始 canvas 就地补成一个可 `dispose()` 的 `MiniThreeRuntime`。

## 必读文件顺序

1. `AGENTS.md`（本文）
2. `llms.txt`
3. `docs/03-module-map.md`（**改哪个文件**）
4. `docs/02-architecture.md` 的「架构不变量」
5. 相关 `docs/adr/*.md`
6. `docs/10-ai-playbook.md`（提示词模板与反模式）

只需读取目标文件及其直接依赖，不要一次性加载整个 `src/`。

## 命令

```bash
npm run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test            # vitest run（单 fork，63 例）
npm run build       # tsup → dist/*.js + *.d.ts
npm run check       # 以上全部
```

Windows 临时目录权限问题：`TMP="$PWD/.tmp/vitest" TEMP="$PWD/.tmp/vitest" npm test`。

## 架构不变量（**不得破坏**）

1. **只有一个上屏画布**：`wx.createCanvas()` 只在 `getScreenCanvas()` 调用一次并缓存，之后的调用只会得到离屏画布。能力探测优先用 `wx.createOffscreenCanvas()`；仅在上屏画布**已解析之后**、且调用方显式 opt-in 时，才可按 [ADR-0007](./docs/adr/0007-capability-probe-fallback.md) 回退到第二次 `createCanvas()`。
2. **对象身份不变**：canvas / image 永远是 `wx` 返回的那个对象。禁止 `new Proxy` 包装、`Object.setPrototypeOf`、返回克隆体。用 `Object.defineProperty` + `Symbol.hasInstance` 注册表。
3. **默认零全局污染**：只有 `installGlobals()` 写 `globalThis`，必须显式调用、必须可逆；三方代码只能经 `getActiveScope()` 拿 shim。
4. **`three` 零运行时依赖**：`src/` 不得 `import 'three'`；它是 optional peer + external。
5. **平台无关核心**：`core/` 不得 import `platforms/*`；差异全部收敛到 `PlatformBinding`。
6. **构建 / 运行隔离**：`build/*` 不 import `core/*`/`platforms/*`；`node:fs` 只在 `build/` 出现。
7. **单一生命周期**：所有订阅、定时器、全局注入登记到 `disposers`，`dispose()` 后无残留。
8. **WebGL2 优先**：`document.createElement('canvas')` 默认 webgl2；无 WebGL2 必须明确告警，不静默降级。
9. **改写只针对自由变量**：AST 重写必须走 `path.scope.hasBinding(name, true)`；禁止字符串/正则全局替换。
10. **破坏性行为必须显式**：全局注入、WebGPU rewrite、深度缓冲补丁等一律 opt-in。

若某改动必须违反其中一条：先写 `docs/adr/NNNN-*.md` 说明动机，再改代码。

## 代码约定

- 严格 TypeScript；`verbatimModuleSyntax`，类型用 `import type`。
- 只用 ASCII 直引号写语法；注释与文档用中文。
- 运行时目标 `es2019`（避免 `?.` / `??` 造成开发者工具语法错误）。
- 每个公开导出都要有 JSDoc 或类型注解，并同步 `docs/04-api-reference.md`。
- 新 polyfill 放 `src/polyfills/`，自包含、不依赖 `core/`。
- 新平台放 `src/platforms/`，实现 `PlatformBinding`，提供可注入 mock 宿主。
- 日志一律用 `Diagnostics`（`warnOnce` 避免每帧刷屏），不要直接 `console.log`。
- 不改写 three 源码语义，不在运行时猴补丁 `WebGLRenderer`。

## 修改后必做（Definition of Done）

- [ ] 新增/更新 `tests/**/*.test.ts`（先写失败用例再修）
- [ ] `npm run check` 全绿
- [ ] `docs/03-module-map.md`（职责变化）、`docs/04-api-reference.md`（导出变化）、`docs/11-compat-matrix.md`（能力变化）
- [ ] `CHANGELOG.md`
- [ ] 触及不变量时新增/更新 ADR
- [ ] 若是平台相关，补/改 `examples/`

## 目录边界

| 目录 | 权限 |
| --- | --- |
| `src/`、`tests/`、`examples/`、`docs/` | 可修改 |
| `dist/`、`node_modules/`、`.tmp/` | 生成物，不手改 |
| `.workbuddy/` | 项目数据，禁止删除 |

## 常见反模式（直接拒绝）

- 「在 `globalThis` 上补个 `window` 就好了」→ 用 `MiniThreeScope`
- 「正则把 `window` 全替换」→ 用 Babel 作用域分析
- 「包一层 Proxy / 改原型」→ 就地 `defineProperty`
- 「探测时先调 `wx.createCanvas()`」→ 用 `createOffscreenCanvas`（`allowCanvasFallback` 只在 `getScreenCanvas()` 之后才有意义）
- 「把 three 打进适配层」→ 保持 external peer
- 「猴补丁 `WebGLRenderer.render` 清深度」→ 应用层显式 `renderer.clearDepth()`

## 需要人类决策时

以下情况**先问再做**：改变公开 API 签名、改变默认行为、新增运行时依赖、放宽架构不变量、删除项目文档、发布版本、修改许可。
