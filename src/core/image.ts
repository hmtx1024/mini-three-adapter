/** Image / ImageData / HTMLImageElement shims built on wx.createImage. */
import type { WxImage, WxLike } from '../platforms/wx-types';
import { MiniCustomEvent } from '../polyfills/event';
import {
  HTMLImageElementShim,
  HTMLElementShim,
  ImageDataShim,
  patchElement,
  type MockClass,
} from './element';
import type { Diagnostics } from './diagnostics';

export interface MiniImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  colorSpace: string;
}

export class ShimImageData implements MiniImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  colorSpace = 'srgb';
  constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth?: number, height?: number) {
    if (typeof widthOrData === 'number') {
      this.width = widthOrData;
      this.height = heightOrWidth ?? widthOrData;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = widthOrData;
      this.width = heightOrWidth ?? 0;
      this.height = height ?? (this.width ? this.data.length / (this.width * 4) : 0);
    }
    ImageDataShim.__instances.add(this);
  }
}

function findDescriptor(target: object, key: string): PropertyDescriptor | undefined {
  let node: object | null = target;
  while (node) {
    const d = Object.getOwnPropertyDescriptor(node, key);
    if (d) return d;
    node = Object.getPrototypeOf(node) as object | null;
  }
  return undefined;
}

/** Keep diagnostic payloads short: a data: URI can be megabytes. */
function describeSrc(src: string): string {
  return src.startsWith('data:') && src.length > 96 ? `${src.slice(0, 64)}…(${src.length} chars)` : src;
}

/** Bound method lookup that never throws (host objects can be exotic). */
function callable(target: object, key: string): ((...args: unknown[]) => unknown) | undefined {
  let value: unknown;
  try {
    value = (target as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
  if (typeof value !== 'function') return undefined;
  try {
    return (value as (...args: unknown[]) => unknown).bind(target);
  } catch {
    return undefined;
  }
}

function ownPropertyNames(target: object): string[] {
  try {
    return Object.getOwnPropertyNames(target).slice(0, 16);
  } catch {
    return [];
  }
}

/** Classify a host callback slot for the diagnostics payload. */
function describeSlot(descriptor: PropertyDescriptor | undefined): string {
  if (!descriptor) return 'missing';
  if (typeof descriptor.set === 'function') return 'accessor';
  return descriptor.writable ? 'data' : 'data-readonly';
}

/**
 * How long to wait before turning a bridge that cannot possibly settle into an
 * observable `error`. Only armed when the host offers no event path at all, so
 * it can never interrupt a slow-but-working load.
 */
const EVENT_WATCHDOG_MS = 2000;

/** How often a pass-through host's `src` is checked for the first write. */
const SRC_POLL_INTERVAL_MS = 100;
/** Give up after this many empty polls (image created but never used). */
const SRC_POLL_MAX_TICKS = 120;

export interface ImageFactory {
  /** `new Image()` returns a wx image object patched with DOM-ish behaviour. */
  Image: new (width?: number, height?: number) => HTMLImageElement;
  HTMLImageElement: MockClass<HTMLImageElement>;
  ImageData: new (
    dataOrWidth: number | Uint8ClampedArray,
    widthOrHeight?: number,
    height?: number,
  ) => MiniImageData;
  createImage(): HTMLImageElement;
  createImageData(width: number, height: number): MiniImageData;
  /** Always undefined on WeChat: Blob is unavailable, so three.js must take its
   *  non-createImageBitmap branch. The build plugin can force this to `void 0`. */
  createImageBitmap: undefined;
}

export function createImageFactory(wx: WxLike, diagnostics?: Diagnostics): ImageFactory {
  const createRaw = (): WxImage => {
    if (typeof wx.createImage === 'function') return wx.createImage();
    if (typeof wx.createOffscreenCanvas === 'function') {
      const off = wx.createOffscreenCanvas({ width: 1, height: 1, type: '2d' });
      if (typeof off.createImage === 'function') return off.createImage();
    }
    throw new Error(
      '[mini-three-adapter] Neither wx.createImage nor OffscreenCanvas.createImage is available. ' +
        'Upgrade the WeChat base library or inject an `imageFactory` in options.',
    );
  };

  const make = (width?: number, height?: number): HTMLImageElement => {
    const raw = createRaw();
    if (width != null) raw.width = width;
    if (height != null) raw.height = height;

    // Capture EVERY native registration entry point before `patchElement` (and
    // the shim accessors further down) shadow them.
    //
    // Relying on `getOwnPropertyDescriptor` alone was the 0.1.4 defect: a host
    // that keeps the callback in a native slot answers `undefined` here, yet
    // still accepts `img.onload = fn` and fires it. The bridge then had no entry
    // point at all and every texture waited for the application's own timeout.
    const nativeLoad = findDescriptor(raw, 'onload');
    const nativeError = findDescriptor(raw, 'onerror');
    const nativeComplete = findDescriptor(raw, 'complete');
    const nativeSrc = findDescriptor(raw, 'src');
    const nativeAdd = callable(raw, 'addEventListener');

    // Snapshot of the host shape, taken before anything of ours can mask it, so
    // a bug report shows what the device actually exposes.
    const hostShape = {
      onload: describeSlot(nativeLoad),
      onerror: describeSlot(nativeError),
      src: describeSlot(nativeSrc),
      addEventListener: nativeAdd ? 'native' : 'missing',
      complete: nativeComplete ? 'native' : 'missing',
      getImageInfo: typeof wx.getImageInfo === 'function' ? 'available' : 'missing',
      ownNames: ownPropertyNames(raw),
    };

    HTMLImageElementShim.__instances.add(raw);
    HTMLElementShim.__instances.add(raw);
    patchElement(raw, {
      rect: { width: raw.width || 0, height: raw.height || 0, left: 0, top: 0, right: raw.width || 0, bottom: raw.height || 0 },
      extra: {
        tagName: { value: 'IMG' },
        nodeName: { value: 'IMG' },
        nodeType: { value: 1 },
      },
    });

    // `src` interception splits on the captured descriptor.
    //
    // Accessor (or missing): installing our own accessor is the point of the
    // shim — `mini-three-blob:` object URLs become data: URIs on write and the
    // fallback chain arms on every write.
    //
    // Native DATA property: the real-device shape (2026-11-21 probe). The write
    // hook lives in the host's property interceptor, and Object.defineProperty
    // replaces it with a plain JS property — even "restoring" the captured
    // descriptor afterwards only writes to the dead plain property (that was
    // 0.1.5's mistake, kept alive by plain-object unit mocks). The image then
    // never loads: width/height stay 0 and `complete` stays false. Such hosts
    // get full pass-through: plain writes reach the interceptor and start the
    // native load, and a bounded poll below arms the fallback chain.
    const srcDescriptor = nativeSrc;
    const srcIsNativeData = Boolean(srcDescriptor && !srcDescriptor.set && srcDescriptor.writable === true);
    let currentSrc = '';
    /** Wired once the bridge exists: a host without an event path only learns
     *  that it needs the fallback when a `src` finally arrives. */
    let onSrcChange: ((src: string) => void) | undefined;

    /**
     * Hand the value to the host. Only reached on the accessor branch: a
     * setter descriptor is forwarded through; anything else either cannot be
     * written at all (read-only) or must not be written through us (data —
     * see the pass-through note above).
     */
    const writeNativeSrc = (next: string): void => {
      if (srcDescriptor?.set) {
        srcDescriptor.set.call(raw, next);
        return;
      }
      diagnostics?.warnOnce(
        'image-no-src-setter',
        'wx image exposes no writable src; the host will never start loading and textures will fail',
        { src: next },
      );
    };

    const installSrcAccessor = (): void => {
      try {
        Object.defineProperty(raw, 'src', {
          configurable: true,
          enumerable: true,
          get: () => (srcDescriptor?.get ? srcDescriptor.get.call(raw) : currentSrc),
          set: (value: string) => {
            const next = String(value);
            currentSrc = next;
            writeNativeSrc(next);
            onSrcChange?.(next);
          },
        });
      } catch {
        /* non-configurable host property: keep the native one */
      }
    };
    if (!srcIsNativeData) installSrcAccessor();

    /**
     * Event flow (the direction matters):
     *
     *   native wx load  ->  forward()  ->  dispatch(MiniEvent)  ->  listeners
     *                                                            \-> inline `onload`
     *
     * `dispatchEvent` already invokes the inline `on<type>` handler, so the
     * forwarder must NOT call the user handler itself or every callback fires
     * twice (and re-dispatching from inside an inline handler would recurse).
     */
    const handlers: Record<'load' | 'error', ((event?: unknown) => void) | undefined> = {
      load: undefined,
      error: undefined,
    };
    /** `load` seen. three's `TextureLoader` treats it as "texture is usable". */
    let settled = false;
    /** `error` seen. Browser semantics: `complete` becomes true on failure too. */
    let failed = false;
    let terminalDetail: unknown;
    const decodeWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
    let watchdogId: ReturnType<typeof setTimeout> | undefined;
    let srcPollId: ReturnType<typeof setTimeout> | undefined;

    /**
     * Depth of the shim dispatch currently in flight. While one runs,
     * `dispatchEvent`'s inline delivery reads `raw['on<type>']`; that read must
     * answer the REGISTERED user handler, not the bridge again, or the inline
     * path would recurse into `finish` instead of calling the app's function
     * (see the accessors below).
     */
    let dispatchDepth = 0;
    const dispatch = (event: unknown): void => {
      dispatchDepth++;
      try {
        (raw as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(event);
      } finally {
        dispatchDepth--;
      }
    };

    /**
     * The single terminal transition. Both outcomes settle `complete` and wake
     * `decode()`; a second native event (some hosts fire `load` and then
     * `error`) is dropped so listeners observe exactly one result.
     */
    const finish = (eventName: 'load' | 'error', detail?: unknown): void => {
      if (settled || failed) return;
      terminalDetail = detail;
      if (eventName === 'load') settled = true;
      else failed = true;
      if (watchdogId !== undefined) {
        clearTimeout(watchdogId);
        watchdogId = undefined;
      }
      if (srcPollId !== undefined) {
        clearTimeout(srcPollId);
        srcPollId = undefined;
      }
      for (const waiter of decodeWaiters.splice(0)) {
        if (eventName === 'load') waiter.resolve();
        else waiter.reject(detail);
      }
      dispatch(new MiniCustomEvent(eventName, { detail }));
    };

    const forwardLoad = (nativeEvent?: unknown): void => { finish('load', nativeEvent); };
    const forwardError = (nativeEvent?: unknown): void => { finish('error', nativeEvent); };

    /** Which native paths actually carry events on this host. */
    let eventPath:
      | 'addEventListener'
      | 'onload'
      | 'addEventListener+onload'
      | 'getImageInfo'
      | 'watchdog'
      | undefined;

    // Tier 1: the host's own `addEventListener`. Captured before `patchElement`,
    // otherwise this call would land in our shim and no native event would ever
    // reach the forwarder.
    if (nativeAdd) {
      try {
        nativeAdd('load', forwardLoad);
        nativeAdd('error', forwardError);
        eventPath = 'addEventListener';
      } catch {
        /* fall through to the slots */
      }
    }

    // Tier 2: plain assignment into the native callback slot — wired REGARDLESS
    // of tier 1, not else-if. The 2026-11-21 probe caught a host whose
    // `addEventListener` is an empty shell: it accepts the registration, then
    // never dispatches image events; the slots were the only live channel and
    // the else-if meant they were never wired. `finish()` is terminal-once, so
    // a host that delivers through both channels still settles exactly once.
    // Must happen BEFORE the user-facing accessors below: after those exist the
    // assignment only writes `handlers` and the host never hears about it.
    try {
      raw.onload = forwardLoad;
      raw.onerror = forwardError;
      // A non-writable slot swallows the assignment silently in sloppy mode.
      if (typeof raw.onload === 'function') {
        eventPath = eventPath === 'addEventListener' ? 'addEventListener+onload' : 'onload';
      }
    } catch {
      /* frozen slot */
    }

    if (!eventPath) {
      diagnostics?.warnOnce(
        'image-native-events',
        'image exposes neither onload/onerror slots nor a native addEventListener; ' +
          'load/error will come from a fallback (wx.getImageInfo or a watchdog)',
        hostShape,
      );
    }

    // User-facing accessors only REGISTER a callback; delivery happens through
    // `dispatchEvent`'s inline path. A host that freezes `onload` cannot be
    // intercepted at all — the warning above already covers that case, so
    // never throw out of createImage().
    //
    // The getter answers TWO different readers, and it must keep the slot
    // CALLABLE (the 0.1.7 real-device defect: it returned the registered
    // handler, which is `undefined` for every `addEventListener` consumer, so
    // hosts that read `image.onload` at trigger time called nothing and every
    // texture died on the watchdog):
    //  - the host itself, on devices that do not consult a stored callback but
    //    READ the property when the image finishes and call whatever comes
    //    back — answer the bridge; `finish()` is terminal-once, so a host that
    //    both stores AND reads cannot double-fire;
    //  - our own `dispatchEvent`, whose inline delivery must call the
    //    registered handler instead of re-entering the bridge — answered via
    //    `dispatchDepth > 0`.
    const forwarders: Record<'load' | 'error', (nativeEvent?: unknown) => void> = {
      load: forwardLoad,
      error: forwardError,
    };
    for (const eventName of ['load', 'error'] as const) {
      try {
        Object.defineProperty(raw, `on${eventName}`, {
          configurable: true,
          enumerable: true,
          get: () => (dispatchDepth > 0 ? handlers[eventName] : forwarders[eventName]),
          set: (next: ((event?: unknown) => void) | null) => {
            handlers[eventName] = typeof next === 'function' ? next : undefined;
          },
        });
      } catch {
        /* non-configurable host property: keep the native one */
      }
    }

    /**
     * Read the host's own `complete` through the descriptor captured at creation
     * time. Reading `raw.complete` here would hit our accessor and recurse.
     */
    const hostComplete = (): boolean => {
      if (!nativeComplete) return false;
      try {
        if (typeof nativeComplete.get === 'function') return Boolean(nativeComplete.get.call(raw));
        return Boolean(nativeComplete.value);
      } catch {
        return false;
      }
    };
    try {
      Object.defineProperty(raw, 'complete', {
        configurable: true,
        enumerable: true,
        get: () => settled || failed || hostComplete(),
      });
    } catch {
      /* non-configurable host property: keep the native one */
    }

    /**
     * Last resort when the host offers no event path at all. `wx.getImageInfo`
     * decodes the file through a separate API, so it can tell "asset is fine,
     * this object just never reports" from "asset is missing / undecodable"
     * (e.g. WebP on devices without a WebP decoder). It does NOT put pixels into
     * the image object, so synthesising a `load` would hand three an empty
     * texture; report a fast, diagnosable `error` instead of a silent hang.
     */
    const getImageInfo = typeof wx.getImageInfo === 'function' ? wx.getImageInfo.bind(wx) : undefined;
    let fallbackStarted = false;

    /**
     * Armed as soon as a `src` arrives, whatever the host shape looks like.
     *
     * "The callback slot accepted our function" is not proof the host will ever
     * call it: some hosts store the assignment and stay silent forever, which is
     * indistinguishable from a working load until the clock runs out. So the
     * watchdog is unconditional; `finish()` clears it on either outcome, and a
     * genuine `load`/`error` always wins because `finish()` is terminal-once.
     */
    const armWatchdog = (): void => {
      if (watchdogId !== undefined) return;
      watchdogId = setTimeout(() => {
        watchdogId = undefined;
        // A host that reports `complete` has decoded the image even if it never
        // reported it: browser semantics say `load` already happened.
        if (hostComplete()) {
          finish('load', { type: 'load', reason: 'watchdog-complete' });
          return;
        }
        // The failure detail reaches the loader's onError, but a bare console
        // would stay silent (the 0.1.7 field report: "no error at all"). The
        // leading token matches the error detail's `reason` so device logs can
        // be grepped for the same identifier.
        diagnostics?.warnOnce(
          'image-events-timeout',
          `image-events-timeout: no load or error event within ${EVENT_WATCHDOG_MS} ms; ` +
            'the texture is reported as failed (package textures decode well inside 2s; ' +
            'slow network images need preloading, docs/06 §6.3.1)',
          { path: eventPath, src: describeSrc(currentSrc) },
        );
        forwardError({ type: 'error', reason: 'image-events-timeout', path: eventPath });
      }, EVENT_WATCHDOG_MS);
    };

    const startFallback = (src: string): void => {
      if (settled || failed || !src) return;
      // Unconditional: a wired slot is not a delivered event (see armWatchdog).
      armWatchdog();
      if (eventPath || fallbackStarted) return;
      fallbackStarted = true;

      if (getImageInfo) {
        eventPath = 'getImageInfo';
        try {
          getImageInfo({
            src,
            success: (info) => {
              diagnostics?.warnOnce(
                'image-events-unavailable',
                `image "${src}" is reachable (${info.width}x${info.height}) but this host delivers no image ` +
                  'events; the texture is reported as failed instead of uploading an empty image',
                hostShape,
              );
              forwardError({
                type: 'error',
                reason: 'image-events-unavailable',
                width: info.width,
                height: info.height,
              });
            },
            fail: (error) => {
              diagnostics?.warnOnce(
                'image-getImageInfo-failed',
                `wx.getImageInfo could not read "${src}"; check the path, the format (WebP is not ` +
                  'decodable on every device) and whether the file is inside the package',
                { errMsg: error?.errMsg, host: hostShape },
              );
              forwardError({ type: 'error', reason: 'getImageInfo-failed', error });
            },
          });
        } catch (error) {
          forwardError({ type: 'error', reason: 'getImageInfo-threw', error });
        }
        return;
      }

      // No event path and no metadata API: the verdict comes from the watchdog.
      eventPath = 'watchdog';
    };
    onSrcChange = startFallback;

    /**
     * Pass-through hosts (native data-property `src`) have no write hook of
     * ours, so the fallback chain arms from a bounded poll instead of the
     * accessor's setter. One outstanding timer per image; stops on the first
     * detected write (the fallbacks take over from there), on a terminal event
     * (`finish` clears it), or after the cap — an image that is created but
     * never given a `src` is not an error and must not keep timers alive.
     */
    const startSrcPoll = (): void => {
      let ticks = 0;
      const tick = (): void => {
        srcPollId = undefined;
        if (settled || failed) return;
        let value = '';
        try {
          const current = (raw as { src?: unknown }).src;
          value = typeof current === 'string' ? current : '';
        } catch {
          value = '';
        }
        if (value) {
          currentSrc = value;
          startFallback(value);
          return;
        }
        if (++ticks < SRC_POLL_MAX_TICKS) srcPollId = setTimeout(tick, SRC_POLL_INTERVAL_MS);
      };
      srcPollId = setTimeout(tick, SRC_POLL_INTERVAL_MS);
    };
    if (srcIsNativeData) startSrcPoll();

    Object.defineProperty(raw, 'crossOrigin', { value: '', writable: true, configurable: true });
    // three's ImageLoader writes `fetchPriority` right after creating the
    // element; predefine it as a plain writable member so that write lands on a
    // known property instead of growing an unknown one on a host object.
    Object.defineProperty(raw, 'fetchPriority', { value: 'auto', writable: true, configurable: true });
    Object.defineProperty(raw, 'decode', {
      value: () => new Promise<void>((resolve, reject) => {
        // Failure first: `complete` is true for a failed image as well, so the
        // browser check must not short-circuit into a resolve.
        if (failed) return reject(terminalDetail);
        if (settled || hostComplete()) return resolve();
        decodeWaiters.push({ resolve, reject });
      }),
      configurable: true,
    });
    return raw as unknown as HTMLImageElement;
  };

  const ImageCtor = function (this: unknown, width?: number, height?: number) {
    return make(width, height);
  } as unknown as new (width?: number, height?: number) => HTMLImageElement;
  Object.defineProperty(ImageCtor, 'name', { value: 'Image' });

  return {
    Image: ImageCtor,
    HTMLImageElement: HTMLImageElementShim,
    ImageData: ShimImageData,
    createImage: () => make(),
    createImageData: (width: number, height: number) => {
      const native = wx.createImageData?.(width, height);
      if (native) {
        const obj = native as object;
        ImageDataShim.__instances.add(obj);
        return obj as MiniImageData;
      }
      return new ShimImageData(width, height);
    },
    createImageBitmap: undefined,
  };
}
