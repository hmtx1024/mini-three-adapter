export { createRuntime, currentScope } from './runtime';
export type {
  MiniThreeRuntime,
  RuntimeOptions,
  RendererHints,
} from './runtime';
export type { PlatformBinding, PlatformFactory } from './platform';
export { detectCapabilities, versionAtLeast } from './capabilities';
export { createDiagnostics, capabilityReport } from './diagnostics';
export type { Diagnostics, LogLevel, Reporter } from './diagnostics';
export { patchElement, createMockClass, markAs, isMarked, normalizeRect } from './element';
export type { MockClass, PatchedElement, PatchElementOptions } from './element';
export {
  HTMLCanvasElementShim,
  HTMLImageElementShim,
  HTMLElementShim,
  OffscreenCanvasShim,
  ImageDataShim,
  WebGLRenderingContextShim,
  WebGL2RenderingContextShim,
  DOMRectShim,
} from './element';
export { patchCanvas, createOffscreenCanvas } from './canvas';
export type { PatchCanvasOptions, PatchedCanvasResult } from './canvas';
export { createImageFactory, ShimImageData } from './image';
export type { ImageFactory, MiniImageData } from './image';
export { createDocument, createScreen, ShimDOMRect } from './dom';
export { PointerBridge } from './pointer';
export type { PointerBridgeOptions, PointerTargets } from './pointer';
export { createFrameScheduler } from './frames';
export type { FrameSchedulerOptions } from './frames';
export { createWindowInfoStore, readWindowInfo } from './window-info';
export type { WindowInfoStore, WindowInfoOptions } from './window-info';
