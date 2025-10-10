import { ref, push, set, get } from "firebase/database";
import fetch from "node-fetch";
import { rtdb } from "../bot/firebaseConfig.js";

async function getChatId(userId) {
  const snap = await get(ref(rtdb, `users/${userId}/telegramId`));
  return snap.exists() ? snap.val() : null;
}

export async function sendBotMessage(userId, text, options = {}) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const chatId = await getChatId(userId); // ✅ await fixed

  if (BOT_TOKEN && chatId) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || "MarkdownV2"
    };

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
      console.error("❌ Direct Telegram send failed:", e);
    }
  }

  // Fallback to queue
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
    console.log("📩 Message queued for bot worker:", p.key);
    return { queued: true, key: p.key };
  } catch (e) {
    console.error("🚨 Failed to queue outbound message:", e);
    throw e;
  }
}
