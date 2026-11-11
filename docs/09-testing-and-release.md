# 09 · 测试、构建与发布

## 9.1 常用命令

```bash
npm install              # 安装依赖
npm run typecheck        # tsc --noEmit（strict）
npm test                 # vitest run（79 例）
npm test -- --watch      # 观察模式
npm run build            # tsup：dist/*.js + *.d.ts + sourcemap
npm run check            # typecheck + test + build
```

Windows 说明：`vitest.config.ts` 使用**单 fork**（`pool: 'forks'`, `singleFork: true`, `fileParallelism: false`, `cache: false`），避免并行 worker 写入系统临时目录时的 `EPERM`。若仍遇到临时目录权限问题：

```bash
TMP="$PWD/.tmp/vitest" TEMP="$PWD/.tmp/vitest" npm test
```

## 9.2 测试结构

| 文件 | 覆盖 |
| --- | --- |
| `tests/scope-rewrite.test.ts` | AST 重写：自由变量、局部遮蔽、对象键、成员属性、`typeof`、import/export、自定义访问器 |
| `tests/polyfills.test.ts` | EventTarget/once/remove、PointerEvent、Blob/URL/base64、URL 解析、TextEncoder、fetch、AbortController |
| `tests/runtime.test.ts` | 画布补丁、scope 隔离、上下文缓存、触摸桥、多指、installGlobals 可逆、resize/dispose、能力报告 |
| `tests/plugin.test.ts` | 资产扫描、未解析资源、模块过滤、WebGPU 告警、manifest 输出 |
| `tests/image-events.test.ts` | 图片事件宿主矩阵：可写描述符 / 仅原生 `addEventListener` / 仅 `wx.getImageInfo` / 三者皆无的 2s watchdog；`complete` 与 `decode()` 的成功/失败语义；`src` 为数据属性时的写入；终态只派发一次；告警去重与宿主形状 payload |
| `tests/event-dispatch.test.ts` | 监听器 `this`、`event.target` / `currentTarget` 指向宿主元素（含 three `ImageLoader` 取图场景）、`event.target` 不暴露内部监听表 |
| `tests/capabilities.test.ts` | 离屏优先 / 无离屏 API 时不兜底 / 主画布回退 / 无法探测返回 `undefined`、`webgl2Source` 三态、回退拿到任一候选上屏画布时按身份放弃（含宿主显式传 `canvas` 的组合） |
| `tests/scope.test.ts` | 未初始化占位作用域：环境全局读作 `undefined`、`typeof window.document` 不抛、真实 API 仍抛可读错误、早读被 `createRuntime()` 点名一次 |
| `tests/helpers/mock-wx.ts` | 可注入的 `wx` 模拟器（`__setSize`、`__touch`、`__canvases`、`__images`） |

**新功能必须带测试**。写测试时优先用 `createMockWx()` 注入，不要在测试里依赖真实 `wx` 或浏览器 DOM。

## 9.3 构建产物

`tsup.config.ts` 有两套配置：

| 配置 | 目标 | 输出 |
| --- | --- | --- |
| runtime | `es2019` / `platform: 'neutral'` / splitting / dts | `dist/index.js`、`dist/core/index.js`、`dist/scope.js`、`dist/polyfills/index.js`、`dist/platforms/*.js` + 共享 chunk |
| build tooling | `node18` / `platform: 'node'` / 不 splitting / dts | `dist/build/vite.js`、`dist/build/rollup.js` |

要点：

- `es2019` 让 esbuild 降级可选链与空值合并，减少开发者工具的语法报错。
- `three` 被标记为 `external`，永远不会进适配层产物。
- `sideEffects` 只声明平台入口文件，保证 tree-shaking 不误删必要的初始化。
- `.d.ts` 由 tsup/dts 生成，`package.json` 的 `exports` 逐个子路径指向它们。

构建后冒烟：

```bash
node --input-type=module -e "
import { rewriteGlobals } from './dist/build/rollup.js';
import { miniThree } from './dist/build/vite.js';
import { createWeChatGameRuntime } from './dist/index.js';
console.log(typeof rewriteGlobals, typeof miniThree, typeof createWeChatGameRuntime);
"
```

## 9.4 建议的 CI 流程

```yaml
# .github/workflows/ci.yml（示意）
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run check
      - name: Verify examples typecheck
        run: |
          cd examples/wechat-minigame && npm ci && npx tsc --noEmit -p tsconfig.json
```

额外建议：

- 在 CI 中打印 `plugin.api.report()`，把 `parseFailures` / `missingAssets` 作为质量门禁（允许白名单）。
- 建立回归用例集：按 controls / loaders / postprocessing / 动画 / 物理分类，每个类别挑选若干 three 官方示例场景，用 `examples/` 的三种平台工程跑通，结果写进 `docs/11-compat-matrix.md`。

## 9.5 发布到 npm

### 9.5.1 发布前检查

```bash
npm run check          # typecheck + 79 例测试 + tsup 构建
npm run release:check  # npm pack --dry-run --json，看将要发布的文件清单
```

`package.json` 已配置 `prepublishOnly: "npm run clean && npm run check"`，`npm publish` 会自动清空 `dist/` 并跑一次完整构建与测试，既不会把未构建的产物发出去，也不会带入历史 hash chunk。发布前确认：

- `files` 白名单只包含 `dist/`、`README.md`、`AGENTS.md`、`llms.txt`、`docs/`（0.1.5 实测 88 个文件、解包 945 KB、tarball 254 KB）。体积主要是 `docs/` 的 Markdown 与 `dist/` 的 `.d.ts`，两者都压缩率极高，tarball 增量很小。
- `exports` 里每个子路径的 `.js` 与 `.d.ts` 都存在。
- `CHANGELOG.md` 已补上本次版本条目。
- `docs/04-api-reference.md` 与 `package.json exports` 一致；`docs/03-module-map.md` 与文件树一致。
- `docs/11-compat-matrix.md` 已登记验证过的 three / 基础库版本。

`package.json` 已配置 `repository` / `homepage` / `bugs`，npm 包页面会展示源码入口与 issue 链接。若仓库迁移，同步修改这三个字段后再发布。

### 9.5.2 准备 npm 账号

1. 在 [npmjs.com](https://www.npmjs.com/signup) 注册账号，并在 **Account → 2FA** 开启双因素认证。
2. 检查包名是否可用（发布前再查一次，避免被占用）：

```bash
npm view mini-three-adapter version
# 404 Not Found = 可用
```

3. 登录：

```bash
npm login            # 浏览器授权，最简单
npm whoami           # 确认已登录
```

CI 或非交互环境用 granular access token（权限选 `Read and write`，并限定到该包）：

```bash
# 不要把这个文件提交到仓库
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
```

### 9.5.3 本地演练（推荐先做）

生成一个真实 tarball，在干净目录里装一次，确认子路径导入都能解析：

```bash
npm pack                                  # 得到 mini-three-adapter-0.1.0.tgz
mkdir -p /tmp/m3-smoke && cd /tmp/m3-smoke
npm init -y && npm pkg set type=module
npm i /path/to/mini-three-adapter-0.1.0.tgz three
node --input-type=module -e "
import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';
import { createWeChatMiniProgramRuntime } from 'mini-three-adapter/wechat-miniprogram';
import miniThree from 'mini-three-adapter/vite';
import { getActiveScope } from 'mini-three-adapter/scope';
console.log(typeof createWeChatGameRuntime, typeof createWeChatMiniProgramRuntime, typeof miniThree, typeof getActiveScope);
"
```

> 未登录也能执行这一步。`npm pack` 生成的文件记得从仓库目录删掉，或把它加进 `.gitignore`。

### 9.5.4 正式发布

```bash
npm publish --access public
```

`publishConfig.access` 已设为 `public`，`--access public` 可省略。执行后 `prepublishOnly` 会自动清空 `dist/` 并跑 `npm run check`。

**npm 的版本号不可覆盖**：同一个 `0.1.0` 只能发一次，之后每次改动都要先升版本再发。24 小时内可以 `npm unpublish <pkg>@<version>` 撤回，超过时间就不能删了；公开包一旦被他人依赖，撤回会影响别人，尽量不要依赖这个能力。

### 9.5.5 发布后验证

```bash
npm view mini-three-adapter version
npm view mini-three-adapter exports --json
```

在任意新项目里执行 `npm i mini-three-adapter three`，再跑一遍 9.5.3 的 import 冒烟。CDN 会在发布后自动可用（如 `https://unpkg.com/mini-three-adapter/`），但小游戏构建走本地 node_modules，不依赖 CDN。

### 9.5.6 后续版本

```bash
# 修 bug
npm version patch && npm publish
# 新增向后兼容能力
npm version minor && npm publish
# 破坏性变更（0.x 阶段也用 minor 时要写进 CHANGELOG）
npm version major && npm publish
```

`npm version` 会自动改 `package.json`、生成 git tag（若已 `git init`）。每次发布重复 9.5.1 的检查。

CI 自动发布（`.github/workflows/publish.yml`）要点：用 `actions/setup-node` 配置 `registry-url`，把 `NPM_TOKEN` 放在仓库 Secrets 里，在 `npm ci && npm run check` 之后执行 `npm publish --provenance --access public`。`--provenance` 会在 npm 页面生成来源证明，需要仓库为 public 且 workflow 具备 `id-token: write` 权限。

### 9.5.7 其他分发方式

| 方式 | 适用场景 |
| --- | --- |
| `npm pack` 把 `.tgz` 直接发给同事 | 还没决定公开，或需要在隔离环境试用；对方 `npm i ./xxx.tgz` |
| `"mini-three-adapter": "file:../.."` | 本机多个项目复用同一份源码 |
| 私有 registry（Verdaccio / GitHub Packages） | 只给团队内部使用，不想发到公共 npm |
| `npm link` | 开发期实时联调，改源码立刻生效 |

发布到公共 npm 之后，业务项目只需 `npm i mini-three-adapter three`，`examples/*/package.json` 里的 `workspace:*` 改成 `"^0.1.0"` 即可。

## 9.6 版本策略

- 遵循语义化版本；`0.x` 阶段 minor 可含破坏性变更，但必须在 CHANGELOG 与接入文档里写明。
- `three` 是 optional peer，`>=0.163.0`（WebGL2 门槛）。three 大版本升级时，重点回归 `DEFAULT_GLOBAL_NAMES` 与 `patchElement` 的属性集合。
- 微信基础库能力变化只影响 `capabilities.ts` / `wechat-common.ts` / `assets.ts`，不应扩散到 `core/`。

## 9.7 真机验收清单（发布前）

- [ ] iOS / Android 各一台，WebGL2 正常出图
- [ ] 多指缩放/旋转（OrbitControls）不卡死，`touchcancel` 后指针计数归零
- [ ] 横竖屏切换后 `resize` 生效，画面不变形
- [ ] 前后台切换后帧循环恢复
- [ ] DRACO / KTX2 资源加载（含分包预下载 Worker）
- [ ] `runtime.dispose()` 后无残留监听、无内存持续增长
- [ ] `runtime.report()` 无 WebGL2 告警
