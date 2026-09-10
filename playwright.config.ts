import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 90000, use: {
    baseURL: 'http://127.0.0.1:4173', headless: true, screenshot: 'only-on-failure',
    launchOptions: process.env.TM_BROWSER_LIBRARY_PATH ? { env: { ...process.env, LD_LIBRARY_PATH: process.env.TM_BROWSER_LIBRARY_PATH, FONTCONFIG_FILE: process.env.TM_FONTCONFIG_FILE } } : {},
  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: false, env: {
    VITE_FIREBASE_API_KEY: 'emulator-only-key', VITE_FIREBASE_PROJECT_ID: 'demo-tm-regression', VITE_FIREBASE_AUTH_DOMAIN: 'demo-tm-regression.firebaseapp.com', VITE_FIREBASE_APP_ID: 'emulator-only-app', VITE_FIREBASE_EMULATORS: 'true',
  } },
});
