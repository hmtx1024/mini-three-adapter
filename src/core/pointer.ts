/**
 * Touch -> Pointer/Mouse event bridge.
 *
 * three.js controls (OrbitControls, MapControls, TrackballControls,
 * TransformControls, r3f events, ...) listen for `pointer*`. WeChat only emits
 * `touch*` (mini program) or `wx.onTouch*` (mini game). This bridge keeps a
 * per-pointer state machine so multi-touch, pointer capture and cancellation
 * behave like the browser instead of replaying one synthetic event per callback.
 */
import { MiniMouseEvent, MiniPointerEvent, type MiniPointerEventInit } from '../polyfills/event';
import type { Rect, TouchLikeEvent, TouchPoint } from '../types';
import type { Diagnostics } from './diagnostics';
import { normalizeRect } from './element';

export interface PointerTargets {
  element: { dispatchEvent(event: unknown): boolean };
  document?: { dispatchEvent(event: unknown): boolean };
  window?: { dispatchEvent(event: unknown): boolean };
}

export interface PointerBridgeOptions {
  getRect: () => Rect | Promise<Rect>;
  targets: PointerTargets;
  /** Dispatch to document/window in addition to the canvas. Default true. */
  propagate?: boolean;
  /** Also emit legacy mouse* / click events. Default true. */
  emitMouseEvents?: boolean;
  diagnostics?: Diagnostics;
}

const TYPE_MAP: Record<string, string> = {
  touchstart: 'pointerdown',
  touchmove: 'pointermove',
  touchend: 'pointerup',
  touchcancel: 'pointercancel',
};

const MOUSE_TYPE_MAP: Record<string, string> = {
  pointerdown: 'mousedown',
  pointermove: 'mousemove',
  pointerup: 'mouseup',
  pointercancel: 'mouseup',
};

function toArrayLike(value: ArrayLike<TouchPoint> | undefined): TouchPoint[] {
  if (!value) return [];
  return Array.prototype.slice.call(value) as TouchPoint[];
}

export class PointerBridge {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly captured = new Map<number, { dispatchEvent(event: unknown): boolean }>();
  private rect: Rect = normalizeRect({ width: 1, height: 1 });
  private rectReady = false;
  private fallbackId = 0xF000;
  private lastTapAt = 0;
  private disposed = false;

  constructor(private readonly options: PointerBridgeOptions) {
    this.refreshRect();
  }

  get activePointerCount(): number {
    return this.pointers.size;
  }

  getRect(): Rect {
    return { ...this.rect };
  }

  setRect(rect: Rect): void {
    this.rect = normalizeRect(rect);
    this.rectReady = true;
  }

  /** Re-read the bounding rect. Async rects update the cache when resolved. */
  refreshRect(): void {
    try {
      const result = this.options.getRect();
      if (result && typeof (result as Promise<Rect>).then === 'function') {
        (result as Promise<Rect>)
          .then((r) => this.setRect(r))
          .catch((error: unknown) => this.options.diagnostics?.warn('pointer rect refresh failed', error));
      } else {
        this.setRect(result as Rect);
      }
    } catch (error) {
      this.options.diagnostics?.warn('pointer rect read failed', error);
    }
  }

  setPointerCapture(pointerId: number, target: { dispatchEvent(event: unknown): boolean }): void {
    this.captured.set(pointerId, target);
  }

  releasePointerCapture(pointerId: number): void {
    this.captured.delete(pointerId);
  }

  /** Accept any WeChat touch-like event and dispatch normalized pointer events. */
  dispatch(event: TouchLikeEvent, overrides: { propagate?: boolean; computeRect?: boolean } = {}): void {
    if (this.disposed) return;
    if (overrides.computeRect) this.refreshRect();
    if (!this.rectReady) {
      this.options.diagnostics?.warnOnce(
        'pointer-rect-not-ready',
        'Pointer event dropped: canvas rect is not available yet. Call await runtime.resize() first.',
      );
      return;
    }

    const type = String(event.type ?? '').toLowerCase();
    const touches = toArrayLike(event.changedTouches) ?? [];
    const active = toArrayLike(event.touches);
    const points = touches.length > 0 ? touches : this.synthesizePoint(event, type);

    if (type === 'touchstart' || type === 'pointerdown') {
      for (const point of points) this.track(point, event, touches.length === 0);
    }

    const pointerType: string = TYPE_MAP[type] ?? (type === 'tap' ? 'pointerup' : '');
    if (!pointerType) {
      this.options.diagnostics?.debug(`ignoring unknown touch event type: ${type}`);
      return;
    }

    for (const point of points) {
      const id = this.identifierOf(point, type);
      const coords = this.toCoords(point, event);
      const primary = this.pointers.size <= 1 || id === this.pointers.keys().next().value;
      const buttons = pointerType === 'pointerup' || pointerType === 'pointercancel' ? 0 : 1;
      const init = {
        pointerId: id,
        pointerType: 'touch' as const,
        isPrimary: primary,
        clientX: coords.x,
        clientY: coords.y,
        pageX: coords.x,
        pageY: coords.y,
        offsetX: coords.offsetX,
        offsetY: coords.offsetY,
        button: pointerType === 'pointerdown' ? 0 : -1,
        buttons,
        bubbles: true,
        cancelable: true,
      };

      if (pointerType === 'pointerdown') {
        this.emit('pointerover', id, init);
        this.emit('pointerenter', id, init);
      }
      this.emit(pointerType, id, init);

      if (this.options.emitMouseEvents !== false) {
        const mouseType = MOUSE_TYPE_MAP[pointerType] ?? 'mouseup';
        const mouse = new MiniMouseEvent(mouseType, {
          ...init,
          button: pointerType === 'pointerdown' ? 0 : 0,
          buttons,
          pointerType: 'mouse',
        });
        this.fanout(mouse, id, overrides.propagate);
      }

      if (pointerType === 'pointerup' || pointerType === 'pointercancel') {
        this.emit('pointerout', id, { ...init, buttons: 0 });
        this.emit('pointerleave', id, { ...init, buttons: 0 });
        this.pointers.delete(id);
        this.captured.delete(id);
      }
    }

    if (type === 'tap' || (type === 'touchend' && Date.now() - this.lastTapAt < 350)) {
      // Some mini-program components emit `tap` without touches; still deliver a
      // click so raycasting / UI libraries work.
      if (type === 'tap') this.lastTapAt = Date.now();
      const point = points[0];
      if (point) {
        const coords = this.toCoords(point, event);
        this.fanout(new MiniMouseEvent('click', {
          pointerId: 1,
          clientX: coords.x,
          clientY: coords.y,
          offsetX: coords.offsetX,
          offsetY: coords.offsetY,
          button: 0,
          buttons: 0,
        }), 1, overrides.propagate);
      }
    }
    void active;
  }

  /** Convenience for mouse events coming from WeChat devtools / PC. */
  dispatchMouse(event: { type: string; x?: number; y?: number; clientX?: number; clientY?: number; button?: number; deltaY?: number }): void {
    const rect = this.rect;
    const x = event.clientX ?? event.x ?? 0;
    const y = event.clientY ?? event.y ?? 0;
    const type = event.type.startsWith('mouse') ? event.type : `mouse${event.type}`;
    const mouse = new MiniMouseEvent(type, {
      pointerId: 1,
      clientX: x,
      clientY: y,
      offsetX: x - rect.left,
      offsetY: y - rect.top,
      button: event.button ?? 0,
      buttons: type === 'mouseup' ? 0 : 1,
      pointerType: 'mouse',
    });
    (mouse as unknown as Record<string, unknown>).wheelDelta = event.deltaY ?? 0;
    this.fanout(mouse, 1);
  }

  dispose(): void {
    this.disposed = true;
    this.pointers.clear();
    this.captured.clear();
  }

  private track(point: TouchPoint, event: TouchLikeEvent, synthetic: boolean): void {
    const id = this.identifierOf(point, event.type ?? 'touchstart');
    const coords = this.toCoords(point, event);
    this.pointers.set(id, { x: coords.offsetX, y: coords.offsetY });
    if (synthetic) this.fallbackId++;
  }

  private identifierOf(point: TouchPoint, type: string): number {
    if (typeof point.identifier === 'number') return point.identifier;
    // touchend / touchcancel often drop the identifier; reuse the only active
    // pointer, otherwise allocate a stable synthetic id.
    if (this.pointers.size === 1) return this.pointers.keys().next().value as number;
    if (type === 'touchend' || type === 'touchcancel' || type === 'tap') {
      return this.pointers.keys().next().value ?? this.fallbackId;
    }
    return this.fallbackId++;
  }

  private synthesizePoint(event: TouchLikeEvent, type: string): TouchPoint[] {
    const detail = (event as Record<string, unknown>).detail as { x?: number; y?: number } | undefined;
    if (detail && typeof detail.x === 'number') {
      return [{ clientX: detail.x, clientY: detail.y ?? 0, identifier: this.pointers.keys().next().value ?? 1 }];
    }
    if (type === 'tap' || type === 'touchend') {
      const last = this.pointers.entries().next().value as [number, { x: number; y: number }] | undefined;
      if (last) return [{ clientX: last[1].x + this.rect.left, clientY: last[1].y + this.rect.top, identifier: last[0] }];
    }
    return [];
  }

  private toCoords(point: TouchPoint, _event: TouchLikeEvent): {
    x: number; y: number; offsetX: number; offsetY: number;
  } {
    const x = point.clientX ?? point.pageX ?? point.x ?? 0;
    const y = point.clientY ?? point.pageY ?? point.y ?? 0;
    return { x, y, offsetX: x - this.rect.left, offsetY: y - this.rect.top };
  }

  private emit(
    type: string,
    pointerId: number,
    init: MiniPointerEventInit = {},
  ): void {
    const ev = new MiniPointerEvent(type, { ...init, pointerId });
    ev.target = this.options.targets.element;
    this.fanout(ev, pointerId);
  }

  private fanout(
    event: MiniPointerEvent | MiniMouseEvent,
    pointerId: number,
    propagateOverride?: boolean,
  ): void {
    const propagate = propagateOverride ?? this.options.propagate ?? true;
    const captured = this.captured.get(pointerId);
    const targets = captured
      ? [captured]
      : [this.options.targets.element, this.options.targets.document, this.options.targets.window];
    for (const target of targets) {
      if (!target) continue;
      if (!propagate && target !== this.options.targets.element && target !== captured) continue;
      (event as { currentTarget?: unknown }).currentTarget = target;
      target.dispatchEvent(event);
      if (event.cancelBubble) break;
    }
  }
}
