import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname, 'src'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dragon: resolve(__dirname, 'src/dragon.html'),
        background: resolve(__dirname, 'src/background.js'),
      },
      output: {
        entryFileNames: chunk =>
          chunk.name === 'background' ? '[name].js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        format: 'es',
      },
    },
  },
  publicDir: resolve(__dirname, 'public'),
});
