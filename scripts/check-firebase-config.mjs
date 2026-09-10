import { loadEnv } from 'vite';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const missing = required.filter(key => !env[key]?.trim());
if (missing.length) {
  console.error('Production deployment stopped: configure the existing Firebase project in private build settings. Missing variable names: ' + missing.join(', '));
  process.exit(1);
}
