# ADR-0002 · 单一 `createRuntime()` / `MiniThreeRuntime` 生命周期

- 状态：Accepted
- 日期：2026-11-08
- 影响模块：`src/core/platform.ts`、`src/core/runtime.ts`、`src/platforms/*`、`src/index.ts`

## 背景

小游戏与小程序的画布获取方式本质不同：前者可以同步拿到唯一的上屏画布，后者需要异步查询节点。如果按平台分别暴露门面，业务代码就要写两套调用方式，订阅、rAF、全局注入也容易散落在各处，缺少统一的销毁入口。

需要一个装配点，把这些差异吸收在内部，对业务只暴露一个对象和一种生命周期。

## 决策

1. 定义结构化契约 `PlatformBinding`（不是抽象基类），把平台差异收敛为一组字段/方法。
2. 只有 `createRuntime(platform, options)` 一个装配入口，返回唯一的 `MiniThreeRuntime`。
3. 三个平台快捷函数（`createWeChatGameRuntime` / `createWeChatMiniProgramRuntime` / `createBrowserRuntime`）只是「构造 binding + 调 createRuntime」的语法糖，全部返回 `Promise<MiniThreeRuntime>`。
4. 小程序异步查询、小游戏同步画布的差异被 `await binding.getCanvasRect()` 吸收；对外只有 `await runtime.resize()` 一种写法。
5. 所有订阅、定时器、全局注入登记到 `disposers`，`runtime.dispose()` 逆序执行；`runtime.on('dispose')` 供业务释放 three 资源。

## 理由

- 用组合（结构化接口）替代继承，平台实现不必继承基类、不必暴露内部装配状态。
- 单一生命周期使「有没有泄漏」变成可测试命题，也让 AI 迭代时只有一个心智模型。
- 统一异步 API 消除了按平台分支带来的文档、类型与接入成本。

## 后果

- 正面：业务代码三端一致；`dispose()` 可验证；新增平台只需实现 `PlatformBinding`。
- 负面：小游戏本来可以同步启动，现在必须 `await` 一次（代价可忽略，且启动时本来就要读窗口信息）。
- 风险：平台实现若忘记把某个监听加入 `dispose()`，仍会泄漏——由 `docs/08` 评审清单与测试约束。

## 被否决的备选方案

- 按平台分别暴露门面再包一层兼容：把复杂度永久留在 API 里，否决。
- 平台抽象基类 + 条件类型：需要继承、难以组合、类型可读性差，否决。

## 验证方式

`tests/runtime.test.ts`：「emits resize and dispose events, and fully tears down」断言 `wx.__touch.start` 被清空、`disposed === true`。
