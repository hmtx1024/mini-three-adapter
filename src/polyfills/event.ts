/** Minimal W3C-compatible event system, independent of any browser global. */
import type { EventListenerLike, EventTargetLike } from '../types';

export interface MiniEventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export class MiniEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly timeStamp: number;
  readonly isTrusted = false;
  defaultPrevented = false;
  cancelBubble = false;
  target: unknown = null;
  currentTarget: unknown = null;
  eventPhase = 0;
  private immediateStopped = false;

  constructor(type: string, init: MiniEventInit = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
    this.composed = init.composed ?? false;
    this.timeStamp = Date.now();
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.cancelBubble = true;
  }

  stopImmediatePropagation(): void {
    this.cancelBubble = true;
    this.immediateStopped = true;
  }

  get _immediateStopped(): boolean {
    return this.immediateStopped;
  }

  composedPath(): unknown[] {
    return this.target == null ? [] : [this.target];
  }
}

export class MiniCustomEvent<T = unknown> extends MiniEvent {
  readonly detail: T;
  constructor(type: string, init: MiniEventInit & { detail?: T } = {}) {
    super(type, init);
    this.detail = init.detail as T;
  }
}

export interface MiniPointerEventInit extends MiniEventInit {
  pointerId?: number;
  pointerType?: 'touch' | 'mouse' | 'pen';
  isPrimary?: boolean;
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  offsetX?: number;
  offsetY?: number;
  button?: number;
  buttons?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  width?: number;
  height?: number;
  pressure?: number;
}

export class MiniPointerEvent extends MiniEvent {
  readonly pointerId: number;
  readonly pointerType: 'touch' | 'mouse' | 'pen';
  readonly isPrimary: boolean;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly button: number;
  readonly buttons: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;

  constructor(type: string, init: MiniPointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
    this.isPrimary = init.isPrimary ?? true;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.pageX = init.pageX ?? this.clientX;
    this.pageY = init.pageY ?? this.clientY;
    this.offsetX = init.offsetX ?? this.clientX;
    this.offsetY = init.offsetY ?? this.clientY;
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? 0;
    this.ctrlKey = init.ctrlKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.altKey = init.altKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.width = init.width ?? 1;
    this.height = init.height ?? 1;
    this.pressure = init.pressure ?? 0.5;
  }
}

export class MiniMouseEvent extends MiniPointerEvent {
  constructor(type: string, init: MiniPointerEventInit = {}) {
    super(type, { pointerType: 'mouse', ...init });
  }
}

export class MiniMessageEvent<T = unknown> extends MiniEvent {
  readonly data: T;
  readonly origin = '';
  readonly lastEventId = '';
  constructor(type: string, init: MiniEventInit & { data?: T } = {}) {
    super(type, init);
    this.data = init.data as T;
  }
}

export class MiniProgressEvent extends MiniEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
  constructor(
    type: string,
    init: MiniEventInit & { lengthComputable?: boolean; loaded?: number; total?: number } = {},
  ) {
    super(type, init);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

export class MiniDOMException extends Error {
  override readonly name: string;
  constructor(message = '', name = 'Error') {
    super(message);
    this.name = name;
  }
}

interface ListenerRecord {
  listener: EventListenerLike | { handleEvent(event: unknown): void };
  once: boolean;
}

/**
 * A small but correct EventTarget. three.js controls only rely on
 * add/remove/dispatch, but we also support `onxxx` inline handlers and `once`,
 * because several addons (and r3f/tresjs) use them.
 */
export class MiniEventTarget implements EventTargetLike {
  private readonly listeners = new Map<string, Set<ListenerRecord>>();
  /**
   * When the EventTarget methods are patched onto a *different* object
   * (`patchEventTarget`), inline `onclick` / `onload` style handlers live on
   * that object, not here. Without this the inline path silently never fires.
   */
  private readonly inlineHost: object | undefined;

  constructor(inlineHost?: object) {
    this.inlineHost = inlineHost;
  }

  addEventListener(
    type: string,
    listener: EventListenerLike | { handleEvent(event: unknown): void } | null,
    options?: boolean | { once?: boolean; capture?: boolean } | unknown,
  ): void {
    if (!listener) return;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const once = typeof options === 'object' && options !== null
      ? Boolean((options as { once?: boolean }).once)
      : false;
    set.add({ listener, once });
  }

  removeEventListener(
    type: string,
    listener: EventListenerLike | { handleEvent(event: unknown): void } | null,
    _options?: unknown,
  ): void {
    if (!listener) return;
    const set = this.listeners.get(type);
    if (!set) return;
    for (const record of set) {
      if (record.listener === listener) set.delete(record);
    }
    if (set.size === 0) this.listeners.delete(type);
  }

  dispatchEvent(event: unknown): boolean {
    const ev = event as MiniEvent | null;
    if (!ev || typeof ev.type !== 'string') return true;
    // `this` is the internal carrier when the methods were patched onto another
    // object. Every observable "who dispatched this" value must be the real
    // element instead: three's ImageLoader keeps `this` as the texture source,
    // so leaking the carrier gives it an object with no pixels.
    const host = (this.inlineHost ?? this) as Record<string, unknown>;
    const target = host as unknown as object;
    if (ev.target == null) ev.target = target;
    ev.currentTarget = target;

    const set = this.listeners.get(ev.type);
    if (set) {
      // copy so listeners may remove themselves during dispatch
      for (const record of Array.from(set)) {
        if (record.once) set.delete(record);
        if (typeof record.listener === 'function') record.listener.call(target, ev);
        else record.listener.handleEvent(ev);
        if (ev instanceof MiniEvent && ev._immediateStopped) break;
      }
      if (set.size === 0) this.listeners.delete(ev.type);
    }

    const inline = host['on' + ev.type];
    if (typeof inline === 'function') (inline as (e: unknown) => void).call(host, ev);

    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }

  /** Remove every listener. Called by `Runtime.dispose()`. */
  clearEventListeners(): void {
    this.listeners.clear();
  }
}

/** Patch EventTarget behaviour onto an existing object without changing identity. */
export function patchEventTarget<T extends object>(target: T): T & MiniEventTarget {
  // The listener map is private state on a dedicated MiniEventTarget instance;
  // methods are bound to it and attached to `target`. Object identity is kept
  // intact, which matters because WeChat keys canvas metadata by identity.
  // `target` is passed as the inline-handler host so `canvas.onpointerdown = fn`
  // and `img.onload = fn` actually fire.
  const own = new MiniEventTarget(target);
  const methods = ['addEventListener', 'removeEventListener', 'dispatchEvent', 'clearEventListeners'];
  for (const key of methods) {
    const fn = (own as unknown as Record<string, unknown>)[key];
    Object.defineProperty(target, key, {
      value: typeof fn === 'function' ? fn.bind(own) : fn,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return target as T & MiniEventTarget;
}
