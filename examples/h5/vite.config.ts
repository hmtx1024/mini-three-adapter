import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

/**
 * The same plugin as the mini game build: three and its addons must have their
 * free global references redirected to the scoped object, otherwise OrbitControls
 * would read the real `window` while the runtime lives in `__m3()`.
 */
export default defineConfig({
  base: './',
  plugins: [miniThree({ webgpu: 'warn' })],
  build: {
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
  },
});
