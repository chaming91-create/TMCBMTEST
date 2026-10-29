import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), {
    name: 'bundled-workbooks',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.xlsx?base64')) return;
      return `export default ${JSON.stringify(readFileSync(id.slice(0, -7)).toString('base64'))};`;
    },
  }],
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
