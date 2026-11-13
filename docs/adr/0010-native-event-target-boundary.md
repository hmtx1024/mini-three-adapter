# ADR-0010 · 原生事件目标不做 EventTarget 替换（H5 canvas 边界）

- 状态：Accepted（限定 [ADR-0004](./0004-in-place-patching.md) 的适用范围）
- 实现状态：已实现，`tests/native-events.test.ts` 13 例覆盖
- 日期：2026-11-13
- 影响模块：`src/core/platform.ts`、`src/core/element.ts`、`src/core/canvas.ts`、`src/core/runtime.ts`、`src/core/pointer.ts`、`src/platforms/browser.ts`、`src/polyfills/event.ts`

## 背景

[ADR-0004](./0004-in-place-patching.md) 决定「就地 patch」：不包装、不改原型，用 `Object.defineProperty` 把 three 需要的 DOM 成员补到宿主返回的那个对象上。其中一条是 `patchEventTarget()`——给对象补 `addEventListener` / `removeEventListener` / `dispatchEvent`。

这条决策的**前提**是：`wx` 返回的 canvas / image 是裸对象，没有 DOM 事件系统，事件方法必须由适配层提供。

H5 双端目标打破了这个前提。`createBrowserRuntime({ canvas })` 传入的是真实 `HTMLCanvasElement`，它本来就有完整事件系统；而 `src/core/runtime.ts` 对 `binding.rawCanvas` 无条件 `patchCanvas()`，于是：

1. `patchElement()` 调用 `patchEventTarget(instance)`，用 `Object.defineProperty` 把三个事件方法写到 canvas **实例自身**，遮蔽了 `EventTarget.prototype` 上的原生实现。
2. 浏览器派发真实事件走宿主内部实现，不经过被覆盖的实例方法；而 `addEventListener` 已被替换，三方库与应用注册的监听器进了 `MiniEventTarget` 的私有 `Map`。结果是**真实输入（pointer / touch / wheel / contextlost）不触发任何监听器**。
3. `MiniEventTarget.dispatchEvent()` 无条件写 `ev.target` 与 `ev.currentTarget`。真实 `Event` 上这两个字段是**只有 getter、没有 setter** 的访问器，ESM 严格模式下赋值直接抛 `TypeError: Cannot set property target of #<Event> which has only a getter`。因此 `canvas.dispatchEvent(realEvent)` 这类事件转发写法在 H5 上一条都送不到，异常抛在入口。
4. `browser` 绑定的 `watchTouch()` 在 patch **之后**才调用 `element.addEventListener`，拿到的是 shim，真实 `touchstart` 也进不了 `PointerBridge`；桌面端鼠标与滚轮更彻底——`browser` 根本没有对应的监听源。
5. 同一路径还覆盖了 `style`、`getBoundingClientRect`、`setAttribute`、`setPointerCapture` 等成员。`canvas.style` 被换成纯 JS 假对象后，写入能读回但不进真实 `CSSStyleDeclaration`；`getBoundingClientRect()` 变成启动时的静态快照。

补充事实：`docs/06-platform-notes.md` §6.3.1 已写明「`patchElement` 会覆盖 `addEventListener`，任何用原生事件的方案都必须在它之前保存引用」。`src/core/image.ts` 照此办理（patch 之前抓四类原生入口），**canvas 这条路径没有做同样的防御**，因为在微信侧它并不需要。

## 决策

1. **能力位下沉到绑定**：`PlatformBinding` 增加 `nativeEventTarget?: boolean` 与 `createEvent?: (type: string, init: NativeEventInit) => unknown`。`browser` 绑定置 `true` 并提供真实构造器（`PointerEvent` / `MouseEvent` / `Event`；构造器缺失时退化为 `new Event()` 后逐字段 `defineProperty` 补齐）。微信两平台不设置，缺省 `false`，行为一字不变。
2. **不替换原生事件目标**：`nativeEventTarget` 为真时，`patchElement()` 跳过 `patchEventTarget()`，`addEventListener` / `removeEventListener` / `dispatchEvent` 保持原生。`clearEventListeners` 也不安装，`runtime.dispose()` 里的 `clearable.clearEventListeners?.()` 已是可选调用。
3. **补缺不覆盖**：同一路径下 `patchElement()` 只补元素上**不存在**的成员（`if (!(key in instance))`）。真实 canvas 已提供的 `style`、`getBoundingClientRect`、`clientWidth`、`setAttribute`、`setPointerCapture`、`nodeType` 一律不动。`patchCanvas()` 仍接管 `getContext()`（上下文缓存与 WebGL 归一化是适配层的价值，原生 `getContext` 身份本就稳定），`toDataURL` 同样只在缺失时补。
4. **派发真实事件**：`PointerBridge` 增加 `createEvent` 选项。设置时 `pointerdown` / `pointermove` / `pointerup` / `pointercancel` / `pointerover` / `pointerenter` / `pointerout` / `pointerleave` / `click` / `mousedown` / `mousemove` / `mouseup` / `wheel` 一律通过平台构造器生成**真实 DOM 事件**再派发；未设置时沿用 `MiniPointerEvent` / `MiniMouseEvent`。
5. **`target` 只由宿主写**：`MiniEventTarget.dispatchEvent()` 不再对非 `MiniEvent` 实例写入 `target` / `currentTarget`。判定条件用 `event instanceof MiniEvent`，而不是 `try/catch` 吞掉异常——后者会把「事件对象形态不对」这个信息一起吞掉。
6. **原生模式下不做 document/window 冒泡**：`PointerBridge.fanout()` 在原生目标上只派发到 `element` 与 `captured`，跳过 `document` / `window` 两个 shim。真实事件从 canvas 派发后由浏览器自己完成冒泡与捕获，适配层没有资格再往假对象上转一份；往假 `MiniEventTarget` 上派发真实事件本身也会触发第 5 条描述的问题。
7. **不重复投递原生输入**：浏览器 canvas 自己就会把可信的 `pointer*` / `wheel` 投递给挂在 `domElement` 上的监听器（`OrbitControls` 正是这样工作），适配层再合成一份会让每次手势触发两次。因此 `browser` 的 `watchTouch()` 在宿主支持 `PointerEvent` 时返回 no-op；只有没有 `PointerEvent` 的旧内核才退回 `touch*` 兜底，并由 `createEvent()` 转成真实事件派发。滚轮完全交给浏览器，`bridge.dispatchMouse({ type: 'wheel' })` 保留给需要手动注入的场景。
8. **不做的事**：`runtime.document` 在 H5 上仍是 scoped shim，不指向真实 `document`。真实 DOM 不被适配层接管，宿主需要的事件监听请直接挂在真实 `document` / `window` 上。`document.createElement('img')` 在 H5 上仍由图片桥接（`createImageFactory` 的四级兜底）接管，不随本次切换——它依赖 shim 分发来保证 `onload` / watchdog 的终态语义，切换需要单独设计。

## 理由

- ADR-0004 的目的是**弥补宿主缺失**，不是**接管宿主已有的能力**。对裸 wx 对象补事件方法是必要的；对真实 DOM 元素补事件方法只会制造一个平行的、互不连通的事件系统。决策的适用边界应当由「目标对象是否自带可用事件系统」来划定。
- ADR-0004 已经写了「就地 patch 保持身份」的原则，本决策不改身份，只改**写入策略**（覆盖 → 补缺）。这与 ADR-0004 兼容，不需要推翻它。
- 「补缺不覆盖」比「按成员白名单跳过」更稳：白名单会随 three 升级与浏览器新增 API 过期，`in` 判断跟随宿主实际形态，且天然覆盖 `style` / `getBoundingClientRect` 这类原生实现更好的成员。
- 用 `instanceof MiniEvent` 判定「谁可以写 target」比 `try/catch` 更好：真实事件与 Mini 事件的差异是**结构性的**，应当在赋值前分支，而不是在异常后补救。小程序侧全部是 `MiniEvent`，行为零变化。
- 原生模式跳过 document/window 冒泡不是功能削减：浏览器已经做了这件事，而且做得更完整（捕获、冒泡、`composedPath`、passive）。再转一份只会重复派发。

## 后果

正面：

- H5 上真实 `pointer` / `touch` / `wheel` / `webglcontextlost` 恢复送达，`OrbitControls` 这类把监听器挂在 `domElement` 上的三方控件可直接工作；
- `canvas.dispatchEvent(realEvent)` 不再抛 `TypeError`，事件转发类写法可用；
- `canvas.style` / `getBoundingClientRect()` / `setPointerCapture()` 回归原生语义，页面布局与 CSS 生效；
- 小程序侧行为不变：`nativeEventTarget` 缺省 `false`，`patchEventTarget` 照旧。

负面 / 风险：

- **双形态**：事件对象可能是 `MiniPointerEvent`，也可能是原生 `PointerEvent`。依赖 `ev instanceof MiniPointerEvent` 判断事件来源的代码需要改用 `ev instanceof scope.PointerEvent`，或只看字段。`docs/04` 需要写清。
- `patchElement()` 的「补缺」分支不看 `rect`，真实元素的 `style.width` 不再随 `updateRect()` 变化——这是**正确行为**（真实元素以布局为准），但会让「改了 rect 却没生效」看起来像 bug。`runtime.resize()` 对真实 canvas 只更新 `bridge` 的 rect 缓存。
- `browser` 绑定不再注册自己的输入源，H5 上的输入完全由浏览器派发；这意味着 `runtime.bridge.activePointerCount` 在 H5 上恒为 0，需要指针计数的应用应直接读原生事件。
- Node 测试环境没有 `PointerEvent`，`createEvent` 会退化到 `Event` + 补字段。测试只能断言「是真实 `Event` 实例且字段齐全」，不能断言 `instanceof PointerEvent`。

## 被否决的备选方案

| 方案 | 否决理由 |
| --- | --- |
| H5 用独立 runtime，不复用 `createRuntime()` | 双端代码分叉，违反 [ADR-0002](./0002-unified-runtime-lifecycle.md) 的单一生命周期；且 `document` / `scope` / 帧调度都要再写一份 |
| 保留覆盖，shim 内部保存原生方法并转调（代理式 shim） | 要同时维护两套监听表，还要自己实现 `once` / `capture` / `passive` / `signal` 语义；关键问题是它**解决不了根因**——浏览器内部派发不会调用被覆盖的 JS 方法，原生监听器仍然收不到 |
| 保留覆盖，只在 `dispatchEvent` 里 `try/catch` 包住 `target` 赋值 | 能消除异常，但真实事件依旧进不来，只是把 P0 变成静默失效；且 `try/catch` 会掩盖事件对象形态错误 |
| 按成员白名单跳过（只跳过 `style` / `getBoundingClientRect`） | 白名单随 three 与浏览器演进过期，漏掉一个就是同类问题复发；`in` 判断跟随宿主形态 |
| 让 `runtime.document` 指向真实 `document` | 会牵连 `installGlobals()` 的可逆性与零全局污染（[ADR-0001](./0001-scoped-globals.md)），超出本次边界；宿主自行监听真实 `document` 即可 |
| 在浏览器里跳过 `patchCanvas()`，完全不碰 canvas | `getContext()` 的缓存与 WebGL 归一化仍有价值（部分内核 `getExtension` 返回数字），且 `instanceof HTMLCanvasElement` 的注册对跨 realm 场景有意义 |

## 验证方式

- 新增 `tests/native-events.test.ts`（原生事件目标，13 例）：
  - `createBrowserRuntime()` 之后 `addEventListener` / `dispatchEvent` 与 patch 前同引用（未被覆盖）；
  - `canvas.style` 与 `getBoundingClientRect()` 未被替换；
  - 原生派发 `webglcontextlost` → `runtime.on('contextlost')` 命中；
  - `canvas.dispatchEvent(new Event(...))` 不抛且送达原生监听器；
  - `runtime.handleTouch()` 派发的是真实 `Event` 实例、原生监听器命中、字段（`clientX` / `clientY` / `pointerId`）齐全；
  - 不向 scoped `document` / `window` 转派；
  - `dispatchMouse({ type: 'wheel' })` 产出 `wheel` 事件且带 `deltaY`；
  - `runtime.createCanvas()` 的离屏画布仍带事件方法（Node 无 `document` 时的 mock 兜底）；
  - 微信小游戏 runtime 的 canvas 仍是 shim（`hasOwnProperty('addEventListener')`、`dispatchEvent({ type })` 可用），防止回退。
- `tests/runtime.test.ts`、`tests/event-dispatch.test.ts`、`tests/image-events.test.ts`、`tests/polyfills.test.ts` 保持通过。
