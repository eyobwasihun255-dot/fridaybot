import { ref, get } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js";
import { gameManager } from "./game-manager.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const roomsSnap = await get(ref(rtdb, "rooms"));
    const roomsData = roomsSnap.exists() ? roomsSnap.val() : {};
    const roomIds = Object.keys(roomsData);

    const rooms = await Promise.all(
      roomIds.map(async (roomId) => {
        const room = await gameManager.getFullRoom(roomId);
        return { id: roomId, ...room };
      })
    );

    return res.json({ rooms });
  } catch (err) {
    console.error("❌ Error fetching rooms list:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}


