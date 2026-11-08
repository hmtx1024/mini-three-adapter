# ADR-0003 · 用 Babel AST 作用域分析重写三方模块全局引用

- 状态：Accepted
- 日期：2026-11-08
- 影响模块：`src/build/scope-rewrite.ts`、`src/build/plugin-core.ts`、`src/build/assets.ts`

## 背景

「不 fork three」的前提是能在构建期把三方代码里的浏览器全局访问重定向到作用域对象。文本或近似作用域替换在以下场景会误伤：

```js
function f(window) { return window.innerWidth; }  // 局部同名
const o = { window: 1 };                          // 对象键
foo.window;                                       // 成员属性
if (typeof window !== 'undefined') { ... }         // 特性检测
```

随着 three 及其生态（three-stdlib、r3f、tresjs）代码量增长，误伤概率与版本升级成本都很高。改写必须建立在真实的词法作用域信息之上。

## 决策

1. 用 `@babel/parser`（`sourceType: 'unambiguous'`，启用 TS/JSX 插件）解析每个候选模块。
2. 用 `@babel/traverse` 的 `ReferencedIdentifier` visitor，只处理**引用位置**的标识符。
3. 通过 `path.scope.hasBinding(name, true)` 判定是否为自由变量（第二参数屏蔽 Babel 内建全局表，否则 `window` 会被当成 binding 而漏改）。
4. 排除非计算的对象键、类成员键、成员表达式属性。
5. 用 `MagicString.overwrite` 精确替换并 `prepend` 一行 `import { getActiveScope as __m3 } from 'mini-three-adapter/scope';`，保留 sourcemap。
6. `globalThis` 故意不在默认清单（three 用它挂调试钩子）。
7. 解析失败 → 记录 `parseFailures`、告警、**原样返回**，绝不产出半改写代码。

## 理由

- 作用域正确性由 Babel 保证，不用自己实现词法作用域。
- 精确 rewrite + sourcemap 便于调试与 CI 统计（`BuildReport`）。
- 把「三方代码」与「应用代码」的边界显式化为 `include(id)`，可审计。

## 后果

- 正面：局部遮蔽、`typeof`、对象键全部正确；支持 TS/JSX；构建报告可观测。
- 负面：构建期新增 `@babel/parser` / `@babel/traverse` / `magic-string` 三个依赖（**只在 Node 侧，不进小游戏包**）；解析有少量构建耗时。
- 风险：Vite 预打包会把 three 变成一个不透明 blob → `vite.ts` 的 `config()` 显式 `optimizeDeps.exclude`；`.vite/deps/three*` 作为兜底 include。
- 风险：某模块用了 Babel 不支持的语法 → 跳过并告警，需人工加插件或 `exclude`。

## 被否决的备选方案

- 正则 / 字符串替换：正确性无法保证，否决。
- Rollup `attachScopes` + 自定义遍历：能拿到作用域但要自己处理所有节点类型，维护成本高，否决。
- 运行时 `with` / Proxy 作用域：性能与严格模式限制，否决。

## 验证方式

`tests/scope-rewrite.test.ts` 8 例：自由变量、局部遮蔽、对象键/成员属性、`typeof`、import/export 不改写、无命中返回 null、自定义访问器、默认清单不含 `globalThis`。
