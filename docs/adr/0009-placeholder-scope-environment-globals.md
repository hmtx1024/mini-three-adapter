# ADR-0009 · 占位作用域的「环境全局」读作 `undefined`

- 状态：Accepted（修订 [ADR-0001](./0001-scoped-globals.md) 的第 5 条）
- 日期：2026-11-10
- 影响模块：`src/scope.ts`、`src/core/runtime.ts`、`src/build/scope-rewrite.ts`（注释与语义边界）

## 背景

ADR-0001 决定：runtime 未创建时 `getActiveScope()` 返回占位对象，`typeof window` 仍是 `'object'`，其余键一读就抛带指引的错误。这个设计在「真的用错了」时很好用，但它把一个**探测**动作也变成了故障点。

复核时确认：

```text
getActiveScope().document
→ Error: [mini-three-adapter] Scoped global "document" was read before a runtime was created.
```

两条路径会撞上它：

1. `typeof document` —— 构建期插件只守卫 `typeof X` 这种**直接操作数**（改写成 `typeof (__m3Has() ? __m3().document : undefined)`）。`typeof window.document` 的操作数是成员表达式，插件只能替换 `window`，第二次取值仍落到占位对象上，`typeof` 立刻抛错。而 `typeof a.b` 在 JavaScript 里本来就允许抛：`typeof` 只对未声明的**标识符**免抛。
2. 任何库在模块顶层写的 `const hasDom = typeof document !== 'undefined'`，只要该模块不是被插件改写的目标（应用层代码默认不改写），又恰好通过 `installGlobals` 暴露到 `globalThis` 上，同样会抛。

「这个宿主有没有 DOM」是所有图形库第一个要问的问题，适配层在这上面抛错，等于把初始化顺序问题伪装成适配层内部故障。

## 决策

1. 占位对象对**环境探测型**全局返回 `undefined`：`document`、`navigator`、`screen`、`location`、`history`。语义上等于「这个宿主没有 DOM」，与 Worker / Node 一致，`typeof` 与真值判断都能正常工作。
2. 其余键（`HTMLCanvasElement`、`TextDecoder`、`Blob`、`fetch` …）**保持抛错**。读它们不是探测而是真实使用，静默 `undefined` 只会把错误推迟到几帧之后、在无关的栈上炸开。
3. 这些早读被记录到模块级集合，`createRuntime()` 启动时 `warnOnce` 汇总一次（`Scoped globals were read before this runtime existed: document`），随后清空。诊断价值从「抛出异常」改为「启动时点名」，不再阻断执行。
4. 占位对象对未知 `Symbol` 键返回 `undefined`，避免 `console.log` / `util.inspect` 之类仅做展示的动作抛错。

## 理由

- `typeof` 是约定俗成的「永不抛错」运算符，第三方库（含 three 的 `WebGL.js`、`ImageLoader`、worker 分支判断）大量依赖这一点。适配层不能成为这个约定的例外。
- 只放开环境探测型的五个键，而不是全部放开：真实 API 的误读仍然在**发生的那一行**报错，这是 ADR-0001 想要保留的性质。两类键的边界清楚可讲：「描述宿主形态的」vs「提供具体能力的」。
- 「启动时点名」比「就地抛错」更适合本项目的失败形态：three 求值过早不会破坏 runtime 本身，只是让某段特性检测走了非浏览器分支，跑起来通常是正常的。用一次告警指出可疑点，比让一整个应用起不来更符合实际后果。

## 后果

正面：

- `typeof document`、`typeof window.document`、`typeof navigator` 在任何时机都不再抛错；
- 早读仍有可发现的痕迹：`getEarlyScopeReads()` 可查，`createRuntime()` 会告警一次，`docs/06` / `docs/07` 的报错对照表给出处理方式；
- 构建期插件的 `typeof` 守卫从「唯一防线」退化为「对真实 API 的补强」，两处逻辑不再互相依赖。

负面 / 风险：

- 依赖「错误立即抛出」来发现初始化顺序问题的用户，现在看到的是告警而不是异常。这是有意的取舍：异常的代价（整个应用起不来、报错指向适配层）高于收益；
- 早读记录是模块级状态，多 runtime 场景下第一次 `createRuntime()` 就会消费并清空它。测试里需要显式 `clearEarlyScopeReads()`；
- 占位对象的行为不再对称（五个键返回 `undefined`，其余抛错），必须靠文档与 ADR 说明，否则后来者容易误以为漏了分支。

## 被否决的备选方案

| 方案 | 否决理由 |
| --- | --- |
| 全部键都返回 `undefined`，彻底不抛 | 真实使用会在离现场几帧的地方以无关形式失败，比 ADR-0001 之前更难排查 |
| 保持现状，靠构建期给 `typeof X.Y` 加守卫 | 需要识别成员链上的每个根，且应用层代码默认不改写，守卫无法覆盖 |
| 让占位对象在第一次 `typeof` 时打 `console.warn` | 只能拿到字符串 `prop`，无法区分探测与使用；且 `Diagnostics` 尚不存在（`src/scope.ts` 不能反向依赖 `core/`） |
| 在 `createRuntime()` 里直接 `throw` | 把「求值过早」升级成硬失败，与本次「不阻断」的取向相反 |

## 验证方式

- 新增 `tests/scope.test.ts`：
  - 环境全局读作 `undefined`，`typeof` 不抛；
  - `typeof window.document` 这种嵌套形态不抛（构建期无法守卫的缺口）；
  - `HTMLCanvasElement` / `TextDecoder` 仍然抛出含指引文案的错误；
  - 早读被记录、`createRuntime()` 告警一次后清空；
  - 没有任何早读时不告警。
- `tests/runtime.test.ts` 与 `tests/scope-rewrite.test.ts` 全部保持通过（改写产物形态未变）。
