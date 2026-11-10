import type { WxCanvas, WxImage, WxLike, WxTouchEvent } from '../../src/platforms/wx-types';

export interface TouchHandlers {
  start?: (event: WxTouchEvent) => void;
  move?: (event: WxTouchEvent) => void;
  end?: (event: WxTouchEvent) => void;
  cancel?: (event: WxTouchEvent) => void;
}

export interface MockImage extends WxImage {
  /** Simulate the host finishing a load / failing one, like the real wx loader. */
  __emit(type: 'load' | 'error', payload?: unknown): void;
}

export interface MockWx extends WxLike {
  __touch: TouchHandlers;
  __resize: Set<() => void>;
  __images: MockImage[];
  __canvases: WxCanvas[];
  __setSize(width: number, height: number): void;
}

function fakeContext(canvas: WxCanvas): Record<string, unknown> {
  return {
    canvas,
    getExtension: () => null,
    getParameter: () => 0,
    drawingBufferWidth: canvas.width,
    drawingBufferHeight: canvas.height,
  };
}

function fakeCanvas(width = 300, height = 150): WxCanvas {
  const canvas: WxCanvas = {
    width,
    height,
    getContext(type: string) {
      if (type === '2d' || type === 'webgl' || type === 'webgl2') return fakeContext(canvas);
      return null;
    },
    toDataURL: () => 'data:image/png;base64,AAAA',
    createImage: () => fakeImage(),
  };
  return canvas;
}

/**
 * Real `wx.createImage()` exposes `onload`/`onerror` as accessors that store the
 * callback — that is exactly why redefining them as data properties used to cut
 * the native load event off. The mock mirrors that shape so the bridge is
 * actually exercised.
 */
function fakeImage(): MockImage {
  let load: ((event?: unknown) => void) | null = null;
  let error: ((event?: unknown) => void) | null = null;
  const img = {
    width: 0,
    height: 0,
    src: '',
    get onload() { return load; },
    set onload(next: ((event?: unknown) => void) | null) { load = next ?? null; },
    get onerror() { return error; },
    set onerror(next: ((event?: unknown) => void) | null) { error = next ?? null; },
    __emit(type: 'load' | 'error', payload?: unknown) {
      const handler = type === 'load' ? load : error;
      handler?.(payload ?? { type });
    },
  };
  return img as unknown as MockImage;
}

export function createMockWx(): MockWx {
  const touch: TouchHandlers = {};
  const resize = new Set<() => void>();
  const images: MockImage[] = [];
  const canvases: WxCanvas[] = [];
  let width = 375;
  let height = 667;
  const wx: MockWx = {
    __touch: touch,
    __resize: resize,
    __images: images,
    __canvases: canvases,
    __setSize(w: number, h: number) { width = w; height = h; },
    createCanvas() {
      const c = fakeCanvas();
      canvases.push(c);
      return c;
    },
    createOffscreenCanvas({ width = 1, height = 1 } = {}) {
      const c = fakeCanvas(width, height);
      canvases.push(c);
      return c;
    },
    createImage() {
      const img = fakeImage();
      images.push(img);
      return img;
    },
    getWindowInfo: () => ({ windowWidth: width, windowHeight: height, pixelRatio: 3 }),
    onWindowResize: (listener) => { resize.add(listener as () => void); },
    offWindowResize: (listener) => { resize.delete(listener as () => void); },
    onTouchStart: (listener) => { touch.start = listener; },
    onTouchMove: (listener) => { touch.move = listener; },
    onTouchEnd: (listener) => { touch.end = listener; },
    onTouchCancel: (listener) => { touch.cancel = listener; },
    offTouchStart: () => { touch.start = undefined; },
    offTouchMove: () => { touch.move = undefined; },
    offTouchEnd: () => { touch.end = undefined; },
    offTouchCancel: () => { touch.cancel = undefined; },
    onShow: () => undefined,
    onHide: () => undefined,
    offShow: () => undefined,
    offHide: () => undefined,
    getPerformance: () => ({ now: () => Date.now() }),
    triggerGC: () => undefined,
    request: (options) => {
      options.success?.({ statusCode: 200, data: new ArrayBuffer(8), header: { 'content-type': 'application/octet-stream' } });
      return {};
    },
  };
  return wx;
}
