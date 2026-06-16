import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: assetInfo => assetInfo.name?.endsWith('.css') ? 'assets/style.css' : 'assets/[name][extname]',
      },
    },
  },
}));
