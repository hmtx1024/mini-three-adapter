import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

/** weapp-vite / uni-app style config; adapt `build.outDir` to your toolchain. */
export default defineConfig({
  plugins: [miniThree({ webgpu: 'warn', assets: { outputDir: 'assets/three' } })],
  build: {
    target: 'es2019',
    outDir: 'dist',
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          return undefined;
        },
      },
    },
  },
});
