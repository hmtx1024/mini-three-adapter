/**
 * H5 dual target: the SAME scene code runs in a browser because scoped globals
 * never overwrite the real `window` / `document`.
 */
import { createBrowserRuntime } from 'mini-three-adapter/browser';

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector('#gl') as HTMLCanvasElement;
  const runtime = await createBrowserRuntime({ canvas, logLevel: 'warn' });
  const { startScene } = await import('./scene.js');
  startScene(runtime);
}
void bootstrap();
