import type { WxCanvas, WxImage, WxLike, WxTouchEvent } from '../../src/platforms/wx-types';

export interface TouchHandlers {
  start?: (event: WxTouchEvent) => void;
  move?: (event: WxTouchEvent) => void;
  end?: (event: WxTouchEvent) => void;
  cancel?: (event: WxTouchEvent) => void;
}

export interface MockWx extends WxLike {
  __touch: TouchHandlers;
  __resize: Set<() => void>;
  __images: WxImage[];
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
    createImage: () => ({ width: 0, height: 0, src: '', onload: null, onerror: null }),
  };
  return canvas;
}

export function createMockWx(): MockWx {
  const touch: TouchHandlers = {};
  const resize = new Set<() => void>();
  const images: WxImage[] = [];
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
      const img: WxImage = { width: 0, height: 0, src: '', onload: null, onerror: null };
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
