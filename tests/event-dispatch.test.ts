import { describe, expect, it, vi } from 'vitest';
import { MiniEvent, MiniEventTarget, patchEventTarget } from '../src/polyfills/event';
import { createImageFactory } from '../src/core/image';
import { createMockWx } from './helpers/mock-wx';

interface Patched extends EventTarget {
  dispatchEvent(event: unknown): boolean;
}

/** Patch a plain object and expose the runtime methods without type noise. */
function patch<T extends object>(el: T): T & Patched {
  return patchEventTarget(el) as unknown as T & Patched;
}

/**
 * DOM 语义：监听器被调用时 `this` 必须是事件目标元素，`event.target` 与
 * `event.currentTarget` 同样指向它。`patchEventTarget` 把方法绑到内部
 * `MiniEventTarget` 上，因此这几处都必须显式转发到宿主对象。
 *
 * 这不是文档洁癖：three 的 `ImageLoader` 在 `onImageLoad` 里用 `this` 取
 * `<img>` 存进 `Texture.source.data`，拿错对象就等于没有像素。
 */
describe('dispatchEvent host semantics', () => {
  it('calls listeners with the patched object as `this`', () => {
    const el = patch({ id: 'img-1' });
    let self: unknown;
    el.addEventListener('load', function (this: unknown) {
      self = this;
    });
    el.dispatchEvent(new MiniEvent('load'));
    expect(self).toBe(el);
  });

  it('points event.target and currentTarget at the patched object', () => {
    const el = patch({ id: 'img-2' });
    let seen: { target: unknown; currentTarget: unknown } | undefined;
    el.addEventListener('load', (e) => {
      const ev = e as unknown as { target: unknown; currentTarget: unknown };
      seen = { target: ev.target, currentTarget: ev.currentTarget };
    });
    el.dispatchEvent(new MiniEvent('load'));
    expect(seen?.target).toBe(el);
    expect(seen?.currentTarget).toBe(el);
  });

  it('keeps `this` as the target itself when not patched onto another object', () => {
    const target = new MiniEventTarget();
    let self: unknown;
    target.addEventListener('tick', function (this: unknown) {
      self = this;
    });
    target.dispatchEvent(new MiniEvent('tick'));
    expect(self).toBe(target);
  });

  it('hands three ImageLoader a usable image through `this`', () => {
    // 复刻 three r187 ImageLoader.onImageLoad 的取图方式。
    const wx = createMockWx();
    const image = createImageFactory(wx).createImage();

    let textureImage: unknown;
    image.addEventListener('load', function (this: unknown) {
      textureImage = this;
    });

    wx.__images[0]!.__emit('load');

    expect(textureImage).toBe(image);
    // 包装对象只有 listeners/inlineHost；真图一定有 src，且 src 可读
    expect((textureImage as { src: string }).src).toBeTypeOf('string');
    expect((textureImage as { inlineHost?: unknown }).inlineHost).toBeUndefined();
  });

  it('never exposes the internal listener map as event.target', () => {
    const el = patch({ kind: 'canvas' });
    const listener = vi.fn((e: unknown) => {
      expect((e as { target: Record<string, unknown> }).target).not.toHaveProperty('listeners');
    });
    el.addEventListener('pointerdown', listener);
    el.dispatchEvent(new MiniEvent('pointerdown'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
