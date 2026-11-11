# 07 · 接入与集成指南

> 面向「已有一个小游戏 / 小程序项目，现在要接入 3D 场景」的场景。本文给出从安装到真机验收的完整接入顺序，不涉及任何其他库。

## 7.1 接入前提

| 条件 | 说明 |
| --- | --- |
| 构建工具 | Vite 或 Rollup（构建插件需要 hook 到模块转换阶段） |
| three 版本 | `>= 0.163.0`，推荐 `0.187.x` |
| 运行环境 | 微信小游戏基础库支持 `getContext('webgl2')`；小程序使用 `<canvas type="webgl2">` |
| TypeScript | 推荐；`@types/three` 与项目 TS 版本配套 |

## 7.2 安装

```bash
npm i mini-three-adapter three
npm i -D vite @types/three
```

`three` 是 optional peer，不会被打进适配层；业务项目自行决定版本。

## 7.3 配置构建插件

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

export default defineConfig({
  plugins: [
    miniThree({
      webgpu: 'warn',
      assets: { outputDir: 'assets/three', brotli: true },
      roots: ['public/decoders'],
    }),
  ],
  build: {
    target: 'es2019',
    minify: false,
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: () => 'game.js' },
    rollupOptions: {
      output: {
        entryFileNames: 'game.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
```

要点：

- `target: 'es2019'` 让可选链 / 空值合并降级，避免开发者工具语法报错。
- `optimizeDeps.exclude` 由插件的 `config()` 自动设置，确保 AST 重写见到 three 的原始 ESM 模块图。
- `manualChunks` 把 three 拆成独立 chunk，便于放进分包。
- Rollup 项目改用 `import { miniThree } from 'mini-three-adapter/rollup'`。

## 7.4 入口改造（**最关键的一步**）

ESM 静态导入会在模块体执行前求值。three 及其 addons 在模块初始化时会读取作用域对象，因此必须**先创建 runtime，再让场景模块加载**：

```ts
// src/main.ts —— 只导入适配层，不在这里导入 three
import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';

async function bootstrap(): Promise<void> {
  const runtime = await createWeChatGameRuntime({
    pixelRatioCap: 2,
    logLevel: 'warn',
  });

  console.log(runtime.report());

  const { startScene } = await import('./scene.js'); // scene.js 内才 import three
  startScene(runtime);

  runtime.on('dispose', () => console.info('runtime disposed'));
}

void bootstrap().catch((error: unknown) => console.error('bootstrap failed', error));
```

```ts
// src/scene.ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MiniThreeRuntime } from 'mini-three-adapter';

export function startScene(runtime: MiniThreeRuntime): void {
  const renderer = new THREE.WebGLRenderer(runtime.rendererHints);
  renderer.setPixelRatio(runtime.windowInfo.pixelRatio);
  renderer.setSize(runtime.windowInfo.width, runtime.windowInfo.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60, runtime.windowInfo.width / runtime.windowInfo.height, 0.1, 100,
  );
  camera.position.z = 3;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial()));

  const controls = new OrbitControls(camera, renderer.domElement);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  runtime.on('resize', (info) => {
    camera.aspect = info.width / info.height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(info.pixelRatio);
    renderer.setSize(info.width, info.height, false);
  });
  runtime.on('dispose', () => {
    renderer.setAnimationLoop(null);
    controls.dispose();
    renderer.dispose();
  });
}
```

若项目结构无法改成动态导入，可在创建 runtime 时打开 `installGlobals: true`，把 shim 显式挂到 `globalThis`；该注入是可逆的，`runtime.dispose()` 会还原。

## 7.5 小程序项目的额外接线

```ts
// pages/index/index.ts
import { createWeChatMiniProgramRuntime, type MiniThreeRuntime } from 'mini-three-adapter';

Page({
  runtime: null as MiniThreeRuntime | null,

  async onReady(): Promise<void> {
    const runtime = await createWeChatMiniProgramRuntime({
      selector: '#gl',
      selectorCtx: this,       // 自定义组件内必须传组件实例
      queryDelay: 0,
      pixelRatioCap: 2,
    });
    this.runtime = runtime;
    const { startScene } = await import('./scene.js');
    startScene(runtime);
  },

  onTouch(event: WechatMiniprogram.TouchEvent): void {
    this.runtime?.handleTouch(event);
  },

  onUnload(): void {
    this.runtime?.dispose();
    this.runtime = null;
  },
});
```

```html
<!-- pages/index/index.wxml -->
<canvas
  type="webgl2"
  id="gl"
  bindtouchstart="onTouch"
  bindtouchmove="onTouch"
  bindtouchend="onTouch"
  bindtouchcancel="onTouch"
  bindtap="onTouch"
/>
```

小游戏不需要这一步：`watchTouch` 会自动订阅 `wx.onTouch*`。

## 7.6 三端接线差异

| 平台 | runtime 工厂 | 触摸事件 | 画布来源 |
| --- | --- | --- | --- |
| 微信小游戏 | `createWeChatGameRuntime()` | 自动 | 唯一上屏画布，自动获取并缓存 |
| 微信小程序 | `createWeChatMiniProgramRuntime({ selector, selectorCtx })` | WXML 转发到 `handleTouch` | `createSelectorQuery` 异步取节点 |
| 浏览器 / H5 | `createBrowserRuntime({ canvas })` | 自动 | 真实 DOM canvas |

三端返回的都是同一个 `MiniThreeRuntime`，因此 `scene.ts` 可以完全复用。

## 7.7 分包与资源配置

构建后检查产物中的 `mini-three-assets.json`，把其中 `gameJsonSuggestion` 的内容合并到 `game.json`：

```json
{
  "workers": { "path": "assets/three", "isSubpackage": true },
  "subpackages": [{ "name": "three-assets", "root": "assets/three/" }]
}
```

- Worker 分包需要先调用 `wx.preDownloadSubpackage({ packageType: 'workers' })`，成功后再 `wx.createWorker()`。
- decoder 路径与 `manifest.decoderPaths` 保持一致，例如 `draco.setDecoderPath('assets/three/')`。
- `assets.brotli: true` 时会一并输出 `.wasm.br`，`WXWebAssembly.instantiate` 支持该后缀。
- `report.missingAssets` 中的条目需要业务把对应文件放进 `roots` 指定目录。

完整可运行工程见 [`examples/wechat-minigame/`](../examples/wechat-minigame/vite.config.ts)、[`examples/wechat-miniprogram/`](../examples/wechat-miniprogram/pages/index/index.wxml)、[`examples/h5/`](../examples/h5/index.html)。

## 7.8 接入检查清单

- [ ] 安装 `mini-three-adapter` + `three >= 0.163.0`，配置 `miniThree()` 插件。
- [ ] 入口改为「先 `createXxxRuntime()`，再动态 `import('./scene.js')`」。
- [ ] 渲染器使用 `runtime.rendererHints`、`setAnimationLoop`、`outputColorSpace`。
- [ ] 小程序 WXML 的 `bindtouch*` 转发到 `runtime.handleTouch`。
- [ ] `resize` / `visibilitychange` / `dispose` 事件都已接线并释放 three 资源。
- [ ] `game.json` 配好 worker 目录与分包，检查 `mini-three-assets.json` 的 `missingAssets` 为空。
- [ ] 构建报告 `plugin.api.report()` 中 `parseFailures` 为空、`webgpuWarnings` 已确认。
- [ ] 真机验证 WebGL2 出图、多指触摸、横竖屏切换、前后台恢复。
- [ ] 保存 `runtime.report()` 能力报告，登记到 [`docs/11-compat-matrix.md`](./11-compat-matrix.md)。

## 7.9 常见报错对照

出现下面的文案时，基本可以按下表直接定位，不必从业务代码查起。

| 报错 / 现象 | 根因 | 处理 |
| --- | --- | --- |
| `Uncaught TypeError: Class constructor xxx cannot be invoked without 'new'`，栈顶在 `GLTFLoader.js` 的 `new TextDecoder()` 处 | 构建期把 `new TextDecoder()` 改成了 `(new __m3()).TextDecoder()` | 升级适配层；临时规避见 [`docs/05` §5.7](./05-build-plugin.md#57-调试构建问题) |
| `SyntaxError: Unexpected token '.'`，产物里出现 `{ __m3().xxx }` | 对象简写属性被原地替换 | 同上 |
| 纹理永远加载不出来、`ImageLoader` 卡满超时；`img.onload` 与 `addEventListener('load')` 都不触发 | 图片 shim 没有把原生 `onload` 桥接到合成事件 | 升级适配层。日志里出现 `image exposes neither onload/onerror slots nor a native addEventListener` 说明宿主三种入口皆无，payload 里的宿主形状可直接贴进 issue；若出现 `wx.getImageInfo could not read` 则先查格式（WebP）与路径 |
| 纹理"加载成功"但画面无变化、法线 / 环境贴图不生效；`texture.image` 没有 `src` 也没有宽高 | 监听器里的 `this` 是内部事件载体，`ImageLoader` 把它当成 `<img>` 存进了 `Texture.source.data` | 升级适配层（0.1.3+）。若业务里自己写过 `image.inlineHost` 取真图，可以删掉 |
| `capabilities.webgl2 === false`，但 `#version 300 es` 能正常渲染 | 能力探测用了离屏画布，离屏与上屏能力不同 | 看 `capabilities.webgl2Source`：`'inferred'` 表示未实测；需要以实测为准时显式传 `capabilities: { webgl2: true }` |
| `Scoped global "xxx" was read before a runtime was created` | 在 `createXxxRuntime()` 之前求值了读 `xxx` 的模块（`document` / `navigator` / `screen` 等环境全局已改为读作 `undefined`，不再抛；能抛的是 `TextDecoder`、`HTMLCanvasElement` 这类真实 API） | 改为动态 `import()`；日志里出现 `Scoped globals were read before this runtime existed` 说明特性检测走了「非浏览器」分支，同样需要调整入口顺序 |
| 触摸事件收不到 | 小程序未转发 `bindtouch*`，或小游戏在 runtime 之后才注册监听 | 见 [`docs/06`](./06-platform-notes.md) 与 §7.5 |
