import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'electron/main/index.mjs') },
      rollupOptions: { output: { entryFileNames: 'index.mjs', format: 'es' } }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'electron/preload/index.mjs') },
      rollupOptions: { output: { entryFileNames: 'index.mjs', format: 'es' } }
    }
  },
  renderer: {
    root: 'src',
    build: {
      // 绝对路径：相对 outDir 会以 root(src) 为基准解析到项目外
      outDir: resolve(process.cwd(), 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/index.html') } }
    },
    plugins: [vue()]
  }
});
