import { defineConfig } from 'vite';
import miniThree from 'mini-three-adapter/vite';

/** Output lands in `dist/` next to game.json, ready for 微信开发者工具. */
export default defineConfig({
  plugins: [
    miniThree({
      webgpu: 'warn',
      assets: {
        outputDir: 'assets/three',
        brotli: true,
      },
      // Add project-specific directories containing DRACO/KTX2 decoder files.
      roots: ['public/decoders'],
    }),
  ],
  build: {
    target: 'es2019', // avoid ?. / ?? for older devtools
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: () => 'game.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'game.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
        // Keep three in a separate chunk so it can be moved to a subpackage.
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/three-stdlib/')) return 'three-stdlib';
          return undefined;
        },
      },
    },
  },
});
