import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBRxd0gLACHrmQ5Jk0RkaY-tjYz9LhKx7g",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "jackpot-fd988.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://jackpot-fd988-default-rtdb.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "jackpot-fd988",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "jackpot-fd988.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "859370808626",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:859370808626:web:851e1452e9e0ec3b66232b"
};

if (typeof window !== 'undefined') {
  // Log Firebase config in the browser for debugging
  console.log('FIREBASE CONFIG:', firebaseConfig);
}

const app = initializeApp(firebaseConfig);

export const rtdb = getDatabase(app);
export const auth = getAuth(app);

export default app;