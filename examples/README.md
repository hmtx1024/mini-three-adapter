# 示例工程

三个示例共用**同一套适配层 API 与同一份场景代码风格**，展示「小游戏 / 小程序 / H5」三端写法差异极小。

| 目录 | 目标 | 入口 |
| --- | --- | --- |
| `wechat-minigame/` | 微信小游戏 | `src/main.ts` → 动态 `import('./scene.js')` |
| `wechat-miniprogram/` | 微信小程序（`<canvas type="webgl2">`） | `pages/index/index.ts` |
| `h5/` | 浏览器 / uni-app H5 双端 | `src/main.ts` |

## 通用规则

1. **先建 runtime，再 import three。** ESM 静态导入会在 runtime 安装作用域之前求值；因此在入口文件里用 `await import('./scene.js')`，让 `three` 及其 addons 在 `setActiveScope()` 之后才加载。若必须静态导入 three，可在 `createXxxRuntime({ installGlobals: true })` 中打开显式全局注入作为兜底。
2. **必须配置构建插件** `miniThree()`。插件把 `three`、`three/addons`、`three-stdlib` 等三方模块中的自由全局变量引用改写为 `__m3().window` 形式；应用代码默认不改写。
3. **不要手动调用 `wx.createCanvas()`**。适配层负责拿到唯一的上屏画布；额外画布用 `runtime.createCanvas()` 或 `document.createElement('canvas')`。
4. **DPR 建议封顶 2**，`pixelRatioCap: 2` 是默认值。
5. **销毁**：页面 `onUnload` / 游戏退出时调用 `runtime.dispose()`，并监听 `runtime.on('dispose', ...)` 释放 three 资源。

## 运行

```bash
# 在仓库根目录先构建适配层
npm install && npm run build

# 小游戏
cd examples/wechat-minigame && npm install && npm run build
# 然后用微信开发者工具（小游戏模式）打开 examples/wechat-minigame，miniprogramRoot = dist/

# H5
cd examples/h5 && npm install && npm run dev
```

> 示例里的 `mini-three-adapter: "file:../.."` 指向仓库根，`npm install` 会建立软链接，改源码后重新 `npm run build` 即可联调。把示例目录单独拷出去运行时，改成 `"mini-three-adapter": "^0.1.0"`（或直接 `npm i mini-three-adapter`），无需先在仓库根目录构建。

## 事件接线差异

| 平台 | 触摸事件来源 | 需要手写的代码 |
| --- | --- | --- |
| 小游戏 | `wx.onTouch*` | 无，`watchTouch` 自动订阅 |
| 小程序 | WXML `bindtouchstart` 等 | `onTouch(e) { this.runtime?.handleTouch(e) }` |
| 浏览器 | DOM 原生的 `pointer*` / `wheel` / `touch*` | 无。`runtime.canvas` 就是真实 `<canvas>`，事件目标未被替换（[ADR-0010](../docs/adr/0010-native-event-target-boundary.md)），三方控件直接监听即可 |

H5 示例接了 `OrbitControls`：拖动旋转、滚轮缩放都由浏览器原生派发，没有任何 `handleTouch` 转发。要快速验证这条链路（需要已构建 `dist/`）：

```bash
npm run build && npm run verify:h5
```

脚本会在真实 Chromium 里给一个真实 `<canvas>` 打补丁，断言原生事件方法未被覆盖、真实 `PointerEvent` 转发不抛错、`webglcontextlost` 能到达 `runtime.on`、`PointerBridge` 派发的是真实 `PointerEvent`。Playwright 是它的可选依赖，未安装时脚本会给出安装命令。
