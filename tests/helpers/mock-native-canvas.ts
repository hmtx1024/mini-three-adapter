/**
 * A canvas that already owns a working event system, the way a real
 * `HTMLCanvasElement` does in the browser.
 *
 * `Node`'s `EventTarget` is used as the base class on purpose: its `Event.target`
 * is a getter without a setter, which is exactly the shape that makes
 * `MiniEventTarget.dispatchEvent()` throw with `Cannot set property target`.
 */
const nativeDispatch = EventTarget.prototype.dispatchEvent;

export interface NativeCanvasRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export class MockNativeCanvas extends EventTarget {
  width = 300;
  height = 150;
  /** Stands in for the real `CSSStyleDeclaration`. */
  style: Record<string, string> = { width: '300px', height: '150px' };

  getBoundingClientRect(): NativeCanvasRect {
    return {
      top: 0,
      left: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height,
    };
  }

  getContext(): unknown {
    return null;
  }

  toDataURL(): string {
    return 'data:,';
  }

  /**
   * What the browser does internally: dispatch goes through the host
   * implementation, never through a (possibly overwritten) instance method.
   */
  dispatchFromHost(event: Event): boolean {
    return nativeDispatch.call(this, event);
  }
}
