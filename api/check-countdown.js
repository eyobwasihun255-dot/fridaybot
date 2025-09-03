import { rtdb } from "../bot/firebaseConfig.js";
import { ref, runTransaction, set as fbset,  get, update } from "firebase/database";
import startGameHandler from "./start-game.js";

const COUNTDOWN_MS = 15 * 1000; // 15 seconds countdown

export default async function handler(req, res) {
  try {
    const roomsRef = ref(rtdb, "rooms");
    const snapshot = await get(roomsRef);
    const rooms = snapshot.val() || {};

    for (const [roomId, room] of Object.entries(rooms)) {
      const currentPlayers = room.players ? Object.keys(room.players).length : 0;

      // 1️⃣ Start countdown if enough players and waiting
      if (room.gameStatus === "waiting" && currentPlayers >= 2) {
        if (!room.countdownEndAt) {
          await update(ref(rtdb, `rooms/${roomId}`), {
            gameStatus: "countdown",
            countdownStartedBy: "server",
            countdownEndAt: Date.now() + COUNTDOWN_MS,
          });
          console.log(`✅ Countdown started for room ${roomId}`);
        }
      }

      // 2️⃣ Start game automatically if countdown ended
      if (
        room.gameStatus === "countdown" &&
        room.countdownEndAt &&
        Date.now() >= room.countdownEndAt
      ) {
        console.log(`⚡ Starting game for room ${roomId}`);
        await startGameHandler(
          {
            body: { roomId },
            method: "POST",
            json: () => {},
          },
          {
            json: () => {},
            status: () => ({})
          }
        );
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ Error in check-countdown:", err);
    res.status(500).json({ error: err.message });
  }
}
