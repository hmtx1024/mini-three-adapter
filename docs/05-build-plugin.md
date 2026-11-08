# 05 · 构建插件原理与配置

> 插件是「不 fork three」这一路线成立的关键。它只在 **Node 构建期**运行，产物不会进入小游戏运行时。

## 5.1 为什么必须改写三方模块

微信小游戏没有 `window` / `document` / `Image` / `URL` 等全局（[官方 Adapter 文档](https://developers.weixin.qq.com/minigame/dev/guide/runtime/adapter.html)）。three 及其 addons 会直接引用这些自由变量。两种办法：

1. 把这些 shim 挂到 `globalThis`（官方 `weapp-adapter` 路线）→ 简单但不可逆、H5 双端冲突。
2. 在编译期把三方模块中的**自由引用**改成 `__m3().window` → 运行时由 `MiniThreeScope` 提供。

本项目选 2，并额外用 AST 作用域分析保证精确。

## 5.2 改写流程（`src/build/scope-rewrite.ts`）

```mermaid
flowchart TD
    A["transform(code, id)"] --> B{"include(id)?"}
    B -->|否| Z["返回 null"]
    B -->|是| C["@babel/parser<br/>sourceType: unambiguous<br/>TS/JSX 插件"]
    C --> D["traverse: ReferencedIdentifier"]
    D --> E{"name ∈ DEFAULT_GLOBAL_NAMES?"}
    E -->|否| D
    E -->|是| F{"非计算属性键 / 成员属性?"}
    F -->|是| D
    F -->|否| G{"path.scope.hasBinding(name, true)?"}
    G -->|是（局部/import/参数）| D
    G -->|否（真正的自由全局）| H["MagicString.overwrite<br/>name → __m3().name"]
    H --> I["prepend:<br/>import { getActiveScope as __m3 } from 'mini-three-adapter/scope'"]
    I --> J["返回 { code, map }"]
```

关键正确性保证：

| 场景 | 处理 |
| --- | --- |
| `function f(window) { return window.x }` | `hasBinding` 命中 → **不改写** |
| `const o = { window: 1 }` | 非计算属性键 → 不改写 |
| `foo.window` | 成员属性 → 不改写 |
| `import { window as w } from 'x'` | import 绑定 → 不改写 |
| `typeof window !== 'undefined'` | 改写成 `typeof __m3().window !== 'undefined'`，结果 `'object'`，three 走浏览器分支（正是我们想要的） |
| `URL.createObjectURL(blob)` | `URL` 与 `Blob` 都改写 |
| 解析失败 | 记录 `parseFailures` + `ctx.warn`，**原样返回**，绝不产出半改写代码 |

`globalThis` **故意不在**默认清单里：three 会用它挂调试钩子（`__THREE_DEVTOOLS__` 等），改写会破坏这些逻辑。

`forceUndef: ['createImageBitmap']`：这些名字同样被改写，但作用域里恒为 `undefined`，于是 three 的 `typeof createImageBitmap !== 'undefined'` 判定为假，自动走非 Blob 分支。宿主环境提供了该 API 却没有原生 `Blob` 实现时，这个开关可以让 three 绕开不可用的代码路径。

## 5.3 默认 include 规则

命中以下路径（Vite/Rollup 的 `id` 会被规范化为 `/`）：

```
/node_modules/three/...
/node_modules/three@<version>/...
/node_modules/three-stdlib/...
/node_modules/@react-three/...
/node_modules/@tresjs/...
/node_modules/.vite/deps/three*          # Vite 预打包产物兜底
```

应用代码默认**不改写**。若确实需要，设 `includeUserCode: true`（会跳过 `mini-three-adapter` 自身）。
`vite.ts` 的 `config()` 额外设置 `optimizeDeps.exclude`，避免 Vite 把 three 预打包成一个不透明显式的 blob。

## 5.4 WebGPU 策略

微信小游戏没有 WebGPU，而 three r180+ 主推 `three/webgpu`。插件检测到 `from 'three/webgpu'` 时：

| `webgpu` | 行为 |
| --- | --- |
| `'warn'`（默认） | 构建告警，记入 `report.webgpuWarnings` |
| `'error'` | 直接失败，强制改用 `WebGLRenderer` |
| `'rewrite'` | 把 `three/webgpu` → `three`、`WebGPURenderer` → `WebGLRenderer`（**仅适用于未使用 TSL/NodeMaterial 的简单场景**） |
| `'ignore'` | 不处理 |

> `'rewrite'` 是有损的：`MeshStandardNodeMaterial`、TSL、`PostProcessing` 没有 WebGLRenderer 等价物，不能靠重命名解决。复杂 WebGPU 项目应改用 WebGL 构建目标。

## 5.5 资源收集（`src/build/assets.ts`）

```mermaid
flowchart LR
    A["扫描模块内字符串字面量<br/>*.wasm / *.wasm.br / *.bin / *.js"] --> B["按关键字过滤<br/>draco/ktx2/basis/meshopt/rhino3dm/zstd/ammo/worker/decoder/transcoder/lottie/sdf"]
    B --> C["在 roots 中按 basename 索引查找"]
    C --> D["collectAssets(): entries + files + missing"]
    D --> E["generateBundle(): emitFile 每个资源"]
    D --> F["emitFile('mini-three-assets.json')"]
```

默认搜索目录：`node_modules/three/examples/jsm/libs`、`node_modules/three/examples/jsm`、`node_modules/three-stdlib`、`public`、`static`，以及用户 `roots`。

`mini-three-assets.json` 内容：

```json
{
  "generatedBy": "mini-three-adapter",
  "outputDir": "assets/three",
  "entries": [{ "reference": "draco_decoder_gltf.wasm", "source": "...", "destination": "assets/three/draco_decoder_gltf.wasm", "kind": "wasm" }],
  "gameJsonSuggestion": {
    "workers": { "path": "assets/three", "isSubpackage": true },
    "subpackages": [{ "name": "three-assets", "root": "assets/three/" }]
  },
  "decoderPaths": { "draco": "assets/three/" },
  "build": { "modulesScanned": 12, "rewrites": 87, "missingAssets": [] }
}
```

约定与限制：

- 微信 Worker 配置只支持**一个目录**，所以 worker 与 wasm 统一输出到同一个 `outputDir`。
- `brotli: true` 时若存在 `xxx.wasm.br` 会一并拷贝；`WXWebAssembly.instantiate` 支持 `.wasm.br`（[官方文档](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html)）。
- Worker 分包需先 `wx.preDownloadSubpackage({ packageType: 'workers' })` 再 `wx.createWorker()`，且**并发最多 1 个 Worker**。
- 找不到资源时只告警并记入 `missingAssets`，不阻断构建——decoder 可能由业务自行放置。

运行时设置 decoder 路径示例：

```ts
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
const draco = new DRACOLoader();
draco.setDecoderPath('assets/three/'); // 与 manifest.decoderPaths.draco 一致
```

## 5.6 Vite / Rollup 差异

| | Vite | Rollup |
| --- | --- | --- |
| 入口 | `mini-three-adapter/vite`（default export `miniThree`） | `mini-three-adapter/rollup`（named `miniThree`） |
| 额外 hook | `config()` 设置 `optimizeDeps.exclude` | 无 |
| `enforce` | `'pre'` | `'pre'` |
| 资源输出 | `generateBundle` 内 `emitFile` | 同 |
| 高级 API | 通过 `/rollup` 子路径获取 | 直接导出 |

## 5.7 调试构建问题

```ts
const plugin = miniThree({ debug: true, report: true });
// 构建后（在 CI 或插件宿主中）
console.log(plugin.api.report());
```

| 现象 | 查哪里 |
| --- | --- |
| three 里仍出现裸 `window` | `report.modulesScanned` 是否为 0 → 调整 `include`；检查 Vite 是否预打包 |
| 局部变量被误改 | `report.globalsSeen`；补 `tests/scope-rewrite.test.ts` 用例 |
| 解析报错 | `report.parseFailures`，考虑给 `rewrite` 加语法插件或 `exclude` 该模块 |
| worker/wasm 没进包 | `report.assetReferences` / `missingAssets`；补 `roots` |
| 包体过大 | 参照 `gameJsonSuggestion` 分包；`manualChunks` 见 [`examples/wechat-minigame/vite.config.ts`](../examples/wechat-minigame/vite.config.ts) |
