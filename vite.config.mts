import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/webview',
  base: './',
  build: {
    outDir: '../../dist/webview',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
