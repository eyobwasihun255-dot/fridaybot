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
    return snapshot.val() as User;
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
