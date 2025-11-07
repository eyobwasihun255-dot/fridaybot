import { rtdb } from "../firebase/config";
import { ref, get as dbGet, set as dbSet, update as dbUpdate } from "firebase/database";
import type { User } from "../store/authStore";

export async function getOrCreateUser(user: {
  telegramId: string;
  username: string;
  language: string;
}): Promise<User> {
  const userRef = ref(rtdb, `users/${user.telegramId}`);
  const snapshot = await dbGet(userRef);
  const now = new Date().toISOString();

  // ✅ If user already exists → just update updatedAt
  if (snapshot.exists()) {
    const existing = snapshot.val() as any;

    // Update only the timestamp, not the rest
    await dbUpdate(userRef, { updatedAt: now });

    // Return the normalized existing user
    const normalized: User = {
      telegramId: String(existing.telegramId),
      username: existing.username || user.username,
      balance: Number(existing.balance ?? 0),
      gamesPlayed: Number(existing.gamesPlayed ?? 0),
      gamesWon: Number(existing.gamesWon ?? 0),
      totalWinnings: Number(existing.totalWinnings ?? 0),
      language: existing.language ?? existing.lang ?? user.language,
      createdAt: existing.createdAt ?? now,
      updatedAt: now,
    };

    return normalized;
  }

  // 🆕 If user does NOT exist → create new record
  const newUser: User = {
    telegramId: user.telegramId,
    username: user.username,
    balance: 0,
    gamesPlayed: 0,
    gamesWon: 0,
    totalWinnings: 0,
    language: user.language,
    createdAt: now,
    updatedAt: now,
  };

  await dbSet(userRef, newUser);
  return newUser;
}
