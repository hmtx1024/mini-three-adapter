import { createWeChatMiniProgramRuntime, type MiniThreeRuntime } from 'mini-three-adapter';

Page({
  data: { ready: false },
  runtime: null as MiniThreeRuntime | null,
  onReadyRef: null as (() => void) | null,

  async onReady(): Promise<void> {
    const runtime = await createWeChatMiniProgramRuntime({
      selector: '#gl',
      selectorCtx: this,
      queryDelay: 0,
      pixelRatioCap: 2,
      logLevel: 'warn',
    });
    this.runtime = runtime;
    this.setData({ ready: true });

    const { startScene } = await import('./scene.js');
    startScene(runtime);
  },

  /** Mini programs deliver touch events through WXML; forward them to the bridge. */
  onTouch(event: WechatMiniprogram.TouchEvent): void {
    this.runtime?.handleTouch(event);
  },

  onUnload(): void {
    this.runtime?.dispose();
    this.runtime = null;
  },
});
