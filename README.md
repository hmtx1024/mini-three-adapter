# mini-three-adapter

> 面向微信小游戏 / 小程序的 Three.js 适配层。TypeScript 优先、ESM、零全局污染、可释放、可测试。

让标准 three.js 场景代码运行在非 WebView 的原生渲染环境里：业务侧照常写 `new THREE.WebGLRenderer({ canvas })`、`three/addons/*` 的控制器与加载器，适配层负责补齐宿主缺失的浏览器环境、桥接触摸事件、管理画布与资源。

---

## 设计要点

- **作用域化 shim**：所有 `window` / `document` / `Image` 等兼容对象集中在一个显式、可替换、可卸载的 `MiniThreeScope` 中，默认不写 `globalThis`。
- **构建期精确重定向**：用 `@babel/parser` + 作用域绑定分析，把三方模块中的自由全局引用改写成 `__m3().window`，局部同名变量、对象键、`typeof` 检测不受影响。
- **就地画布补丁**：在宿主返回的原始 canvas 对象上定义属性，配合 `Symbol.hasInstance` 注册表满足 `instanceof` 判定，保持对象身份不变。
- **统一生命周期**：`createRuntime()` 装配出唯一的 `MiniThreeRuntime`，订阅、定时器、全局注入统一登记，`dispose()` 后无残留。
- **三端同源**：小游戏 / 小程序 / 浏览器各自实现 `PlatformBinding`，对外 API 完全一致。
- **WebGL2 主线**：适配 three ≥ r163，能力探测不占用唯一的上屏画布。
- **可观测**：分级日志、一次性告警、`runtime.report()` 能力报告、`plugin.api.report()` 构建报告。

架构全貌见 [`docs/02-architecture.md`](./docs/02-architecture.md)，设计约束见 [`docs/01-design-principles.md`](./docs/01-design-principles.md)。

---

## 快速开始

### 安装

```bash
npm i mini-three-adapter three
npm i -D vite @types/three
```

需要 `three >= 0.163.0`（WebGL2）与 Node.js >= 18。

### 1) 配置构建插件

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

export default defineConfig({
  plugins: [miniThree({ assets: { outputDir: 'assets/three' } })],
  build: { target: 'es2019' },
});
```

### 2) 创建 runtime（**必须先于 three 的求值**）

```ts
// src/main.ts
import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';

const runtime = await createWeChatGameRuntime({ pixelRatioCap: 2 });
const { startScene } = await import('./scene.js'); // 动态导入 three
startScene(runtime);
```

```ts
// src/scene.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MiniThreeRuntime } from 'mini-three-adapter';

export function startScene(runtime: MiniThreeRuntime) {
  const renderer = new THREE.WebGLRenderer(runtime.rendererHints);
  renderer.setPixelRatio(runtime.windowInfo.pixelRatio);
  renderer.setSize(runtime.windowInfo.width, runtime.windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, runtime.windowInfo.width / runtime.windowInfo.height, 0.1, 100);
  camera.position.z = 3;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()));

  const controls = new OrbitControls(camera, renderer.domElement); // 触摸自动接入
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setSize(info.width, info.height, false);
  });
  runtime.on('dispose', () => { renderer.setAnimationLoop(null); controls.dispose(); renderer.dispose(); });
}
```

小程序换成 `createWeChatMiniProgramRuntime({ selector: '#gl', selectorCtx: this })`，并在 WXML 上把 `bindtouch*` 事件转发给 `runtime.handleTouch(e)`。完整接入步骤见 [`docs/07-integration-guide.md`](./docs/07-integration-guide.md)，可运行示例见 [`examples/`](./examples/README.md)。

---

## 架构速览

```
                 ┌──────────────────── 构建期 ────────────────────┐
  three / addons │  @babel/parser + scope analysis                 │
  ──────────────►│  window.x  ──►  __m3().window.x                 │──► bundle
                 │  worker/wasm 收集 + manifest + game.json 建议    │
                 └────────────────────────────────────────────────┘

                 ┌──────────────────── 运行期 ────────────────────┐
  PlatformBinding│  raw canvas / metrics / image / touch / raf     │
  ──────────────►│              createRuntime()                    │
                 │  ├─ patchCanvas (in-place, Symbol.hasInstance)  │
                 │  ├─ MiniThreeScope (window/document/polyfills)  │
                 │  ├─ PointerBridge (touch → pointer/mouse)        │
                 │  ├─ FrameScheduler (delta / fpsCap / fps)        │
                 │  └─ WindowInfoStore (DPR cap / resize)           │
                 └──────────────────► MiniThreeRuntime (disposable) │
```

详见 [`docs/02-architecture.md`](./docs/02-architecture.md) 与 [`docs/03-module-map.md`](./docs/03-module-map.md)。

---

## 关键能力

- **零全局污染**：默认只向 `getActiveScope()` 提供 shim；`installGlobals()` 是显式且可逆的逃生舱。
- **WebGL2 优先**：适配 three ≥ r163（已移除 WebGL1 支持），能力探测不占用上屏 canvas。
- **统一事件桥**：多点触控、pointerId 跟踪、pointer capture、`pointercancel`、`typeof window` 特性检测全部可用。
- **资源管线**：`Blob`/`URL.createObjectURL` → `data:` URI，`fetch`/`XHR` → `wx.request`，`TextEncoder/Decoder`、`atob/btoa`、`AbortController`。
- **构建期资产收集**：DRACO / KTX2 / meshopt / rhino3dm 的 wasm 与 worker 自动拷贝，输出 `mini-three-assets.json` 与 `game.json` 建议，支持 `.wasm.br`。
- **可观测**：分级日志、`warnOnce`、`runtime.report()` 能力报告、构建报告 `plugin.api.report()`。
- **AI 友好**：[`AGENTS.md`](./AGENTS.md)、[`llms.txt`](./llms.txt)、[`docs/10-ai-playbook.md`](./docs/10-ai-playbook.md)、逐条 ADR。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/README.md](./docs/README.md) | 文档总索引与推荐阅读顺序 |
| [01 设计目标与技术约束](./docs/01-design-principles.md) | 项目定位、环境约束、技术选型、能力边界 |
| [02 架构设计](./docs/02-architecture.md) | 分层、数据流、不变量 |
| [03 模块地图](./docs/03-module-map.md) | 每个源文件职责 / 依赖 / 修改入口（AI 专用） |
| [04 API 参考](./docs/04-api-reference.md) | 全部导出与类型 |
| [05 构建插件](./docs/05-build-plugin.md) | AST 重写、资产收集、配置 |
| [06 平台差异与坑](./docs/06-platform-notes.md) | 平台能力、已知问题、诊断 |
| [07 接入与集成指南](./docs/07-integration-guide.md) | 从零接入现有项目、分包、检查清单 |
| [08 扩展指南](./docs/08-extension-guide.md) | 新平台 / 新 polyfill / 新资源规则 |
| [09 测试与发布](./docs/09-testing-and-release.md) | 命令、CI、发布流程 |
| [10 AI 协作手册](./docs/10-ai-playbook.md) | 提示词模板与迭代工作流 |
| [11 兼容矩阵](./docs/11-compat-matrix.md) | three / 基础库 / 平台 |
| [ADR](./docs/adr/README.md) | 关键设计决策记录 |

---

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (79 tests)
npm run build       # tsup: dist/*.js + dist/*.d.ts
npm run check       # 以上三项
```

## 许可

MIT。
