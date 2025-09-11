import { rtdb } from "../firebase/config";
import { ref, get as dbGet, set as dbSet } from "firebase/database";
import type { User } from "../store/authStore"; // ✅ reuse same type

export async function getOrCreateUser(user: {
  telegramId: string;
  username: string;
  language: string;
}): Promise<User> {
  const userRef = ref(rtdb, `users/${user.telegramId}`);
  const snapshot = await dbGet(userRef);

  if (snapshot.exists()) {
    const existing = snapshot.val() as any;
    const now = new Date().toISOString();

    const normalized: User = {
      telegramId: String(existing.telegramId ?? user.telegramId),
      username: existing.username ?? user.username,
      balance: Number(existing.balance ?? 0),
      gamesPlayed: Number(existing.gamesPlayed ?? 0),
      gamesWon: Number(existing.gamesWon ?? 0),
      totalWinnings: Number(existing.totalWinnings ?? 0),
      language: existing.language ?? existing.lang ?? user.language,
      createdAt: existing.createdAt ?? now,
      updatedAt: now,
    };

    // If any key differs, write back normalized user
    const needsUpdate = Object.keys(normalized).some(
      (k) => (existing as any)[k] !== (normalized as any)[k]
    );
    if (needsUpdate) {
      await dbSet(userRef, normalized);
    }
    return normalized;
  } else {
    const now = new Date().toISOString();
    const newUser: User = {
      telegramId: user.telegramId,
      username: user.username,
      balance: 10, // starting balance
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
}
