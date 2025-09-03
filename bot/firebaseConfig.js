// bot/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import dotenv from "dotenv";

dotenv.config();

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID, 
  appId: process.env.FIREBASE_APP_ID,
};

// Add error handling for missing configuration
if (!firebaseConfig.projectId) {
  console.error('FIREBASE FATAL ERROR: Missing Firebase Project ID. Please set FIREBASE_PROJECT_ID environment variable.');
  throw new Error('Firebase Project ID is required');
}

if (!firebaseConfig.databaseURL) {
  console.error('FIREBASE FATAL ERROR: Missing Firebase Database URL. Please set FIREBASE_DATABASE_URL environment variable.');
  throw new Error('Firebase Database URL is required');
}

const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export default app;
