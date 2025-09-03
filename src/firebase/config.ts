import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (typeof window !== 'undefined') {
  // Log Firebase config in the browser for debugging
  console.log('FIREBASE CONFIG:', firebaseConfig);
}

// Add error handling for missing configuration
if (!firebaseConfig.projectId) {
  console.error('FIREBASE FATAL ERROR: Missing Firebase Project ID. Please set VITE_FIREBASE_PROJECT_ID environment variable.');
  throw new Error('Firebase Project ID is required');
}

if (!firebaseConfig.databaseURL) {
  console.error('FIREBASE FATAL ERROR: Missing Firebase Database URL. Please set VITE_FIREBASE_DATABASE_URL environment variable.');
  throw new Error('Firebase Database URL is required');
}

const app = initializeApp(firebaseConfig);

export const rtdb = getDatabase(app);
export const auth = getAuth(app);

export default app;