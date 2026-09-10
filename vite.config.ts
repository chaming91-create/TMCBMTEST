import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), { name: 'deployment-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'deployment.json', source: JSON.stringify({ commit: process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), dataSchema: 2, storage: 'firestore', builtAt: new Date().toISOString() }) }); } }],
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
