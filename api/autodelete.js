// server/auto-delete.js
import { ref, get, remove } from 'firebase/database';
import { rtdb } from '../bot/firebaseConfig.js';

const CLEAN_30MIN_MS = 30 * 60 * 1000;   // 30 minutes
const CLEAN_6HOURS_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Delete node safely if it exists.
 */
const deleteNode = async (path) => {
  try {
    const nodeRef = ref(rtdb, path);
    const snap = await get(nodeRef);
    if (snap.exists()) {
      await remove(nodeRef);
      console.log(`🧹 Deleted node: /${path}`);
    } else {
      console.log(`✅ No data found for /${path}, skipped`);
    }
  } catch (err) {
    console.error(`❌ Error deleting /${path}:`, err);
  }
};

/**
 * Clean nodes every 30 minutes (deductRdbs, winingHistory)
 */
const cleanEvery30Minutes = async () => {
  console.log('⏰ [Auto-Delete] Running 30-minute cleanup...');
  await deleteNode('deductRdbs');
  await deleteNode('winingHistory');
};

/**
 * Clean nodes every 6 hours (deposits, withdrawals, games)
 */
const cleanEvery6Hours = async () => {
  console.log('⏰ [Auto-Delete] Running 6-hour cleanup...');
  await deleteNode('withdrawals');
};

// --- Schedule intervals ---
setInterval(cleanEvery30Minutes, CLEAN_30MIN_MS);
setInterval(cleanEvery6Hours, CLEAN_6HOURS_MS);

// --- Optional immediate first run ---
cleanEvery30Minutes();
cleanEvery6Hours();

console.log('🧩 Auto-delete service initialized.');
export default {};