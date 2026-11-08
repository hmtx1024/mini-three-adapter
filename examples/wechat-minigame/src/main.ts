/**
 * WeChat Mini Game entry.
 *
 * IMPORTANT — bootstrap order: create the runtime BEFORE three.js is evaluated.
 * Static `import * as THREE from 'three'` at the top of this file would run
 * before `setActiveScope()`, so use a dynamic import for the scene module.
 */
import { createWeChatGameRuntime } from 'mini-three-adapter/wechat-game';

async function bootstrap(): Promise<void> {
  const runtime = await createWeChatGameRuntime({
    pixelRatioCap: 2,
    logLevel: 'warn',
    // Uncomment if a library cannot be transformed and reads real globals:
    // installGlobals: true,
  });

  console.log(runtime.report());

  const { startScene } = await import('./scene.js');
  startScene(runtime);

  runtime.on('dispose', () => {
    console.info('[demo] runtime disposed');
  });
}

void bootstrap().catch((error: unknown) => {
  console.error('[demo] bootstrap failed', error);
});
