// notifyPlayersInActiveRooms.js
import { ref, get } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";
import { sendBotMessage } from "./notifier.js";

export async function notifyInactiveClaimedPlayers() {
  const roomsRef = ref(rtdb, "rooms");
  const roomsSnap = await get(roomsRef);
  if (!roomsSnap.exists()) return;

  const rooms = roomsSnap.val();
  const now = Date.now();

  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.status !== "playing") continue;

    const cards = room.cards || {};
    for (const [cardId, card] of Object.entries(cards)) {
      if (card.claimed && card.claimedBy) {
        const playerId = card.claimedBy.toString();

        // Check if player is active in the mini-app
        const userRef = ref(rtdb, `users/${playerId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) continue;

        const user = userSnap.val();

        // ✅ If user not active recently (e.g., 2 minutes)
        const lastActive = user.lastActiveAt || 0;
        const inactiveFor = now - lastActive;

        if (inactiveFor > 2 * 60 * 1000) {
          const message = `🎯 Your Bingo card in *${room.name || "a room"}* is now playing!\nJoin quickly to not miss your numbers:\n/playgame`;
          await sendBotMessage(playerId, message);
          console.log(`📢 Notified inactive player ${playerId} for room ${roomId}`);
        }
      }
    }
  }
}
