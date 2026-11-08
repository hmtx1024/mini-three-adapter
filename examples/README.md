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
cd examples/h5 && npm install && npx vite --host
```

> 示例中的 `mini-three-adapter: "workspace:*"` 用于在本仓库内直接联调源码。把示例目录单独拷出去运行时，改成 `"mini-three-adapter": "^0.1.0"`（或直接 `npm i mini-three-adapter`），无需先在仓库根目录构建。

## 事件接线差异

| 平台 | 触摸事件来源 | 需要手写的代码 |
| --- | --- | --- |
| 小游戏 | `wx.onTouch*` | 无，`watchTouch` 自动订阅 |
| 小程序 | WXML `bindtouchstart` 等 | `onTouch(e) { this.runtime?.handleTouch(e) }` |
| 浏览器 | DOM `touchstart` 等 | 无，`watchTouch` 自动订阅 |
