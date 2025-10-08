import { ref, push, set } from "firebase/database";
import fetch from "node-fetch"; // ensure node-fetch installed or use native fetch in newer Node
import { rtdb } from "../bot/firebaseConfig.js";


async function getChatId(userId) {
  const snap = await get(ref(rtdb, `users/${userId}/telegramId`));
  return snap.exists() ? snap.val() : null;
}

 /* sendBotMessage(userId, text)
 * - Tries to send directly via Telegram if BOT_TOKEN and mapping exist.
 * - Otherwise writes a queue entry to RTDB under outboundMessages/ for the bot worker.
 *
 * config env:
 *  - BOT_TOKEN (optional)
 *  - TELEGRAM_CHAT_MAP (optional): JSON string map of userId -> chat_id
 *
 * Returns a Promise.
 */
export async function sendBotMessage(userId, text, options = {}) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const TELEGRAM_CHAT_MAP = getChatId(userId);

  // If token and mapping available, try direct send
  if (BOT_TOKEN && TELEGRAM_CHAT_MAP ) {
    const chatId = TELEGRAM_CHAT_MAP;
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || "Markdown"
    };

    // Use fetch directly (node-fetch or native)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const j = await res.json();
      if (!j.ok) throw new Error(JSON.stringify(j));
      return j;
    } catch (e) {
      console.error("Direct Telegram send failed, falling back to queue:", e);
      // fallback to queue below
    }
  }

  // Fallback: queue message to RTDB
  try {
    const node = {
      userId,
      text,
      createdAt: Date.now(),
      status: "queued",
      meta: options
    };
    const outRef = ref(rtdb, `outboundMessages`);
    const p = push(outRef);
    await set(p, node);
    return { queued: true, key: p.key };
  } catch (e) {
    console.error("Failed to queue outbound message:", e);
    throw e;
  }
}