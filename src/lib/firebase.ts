import { initializeApp,getApps } from 'firebase/app';import { getAuth, connectAuthEmulator } from 'firebase/auth';import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';import { getStorage } from 'firebase/storage';
const config={apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID,storageBucket:import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,appId:import.meta.env.VITE_FIREBASE_APP_ID};
export const firebaseConfigured=Boolean(config.apiKey&&config.projectId);export const app=firebaseConfigured?(getApps()[0]??initializeApp(config)):null;export const auth=app?getAuth(app):null;export const db=app?getFirestore(app):null;export const storage=app?getStorage(app):null;

// Local emulator connections are excluded from production builds.
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true' && auth && db) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
