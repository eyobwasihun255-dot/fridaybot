// notifyPlayersInActiveRooms.js
import { ref, get, update } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";
import { sendBotMessage } from "./notifier.js";

/**
 * Notify players who have claimed cards in active rooms
 * but are inactive based on their updatedAt timestamp.
 */
export async function notifyInactiveClaimedPlayers() {
  const roomsRef = ref(rtdb, "rooms");
  const roomsSnap = await get(roomsRef);
  if (!roomsSnap.exists()) return;

  const rooms = roomsSnap.val();
  const now = Date.now();
  const INACTIVITY_THRESHOLD = 2 * 60 * 1000; // 2 minutes
  const NOTIFY_COOLDOWN = 10 * 60 * 1000; // 10 minutes between reminders

  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.status !== "playing") continue;

    const cards = room.cards || {};
    for (const [cardId, card] of Object.entries(cards)) {
      if (!card.claimed || !card.claimedBy) continue;

      const playerId = card.claimedBy.toString();
      const userRef = ref(rtdb, `users/${playerId}`);
      const userSnap = await get(userRef);
      if (!userSnap.exists()) continue;

      const user = userSnap.val();
      if (!user.updatedAt) continue;

      const lastUpdated = new Date(user.updatedAt).getTime();
      const inactiveFor = now - lastUpdated;

      const lastNotifiedAt = user.lastNotifiedAt
        ? new Date(user.lastNotifiedAt).getTime()
        : 0;
      const sinceLastNotify = now - lastNotifiedAt;

      // Only notify if inactive and not notified recently
      if (inactiveFor > INACTIVITY_THRESHOLD && sinceLastNotify > NOTIFY_COOLDOWN) {
        const message = `🎯 Your Bingo card in *${room.name || "a room"}* is now playing!\nJoin quickly before you miss numbers:\n/playgame`;

        await sendBotMessage(playerId, message);
        console.log(`📢 Notified inactive player ${playerId} for room ${roomId}`);

        // Record notification timestamp to avoid spam
        await update(userRef, { lastNotifiedAt: new Date().toISOString() });
      }
    }
  }
}
