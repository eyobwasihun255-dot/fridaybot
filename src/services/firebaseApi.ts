import { rtdb } from "../firebase/config";
import { ref, get, set } from "firebase/database";
 // ✅ import your interface

interface User {
  telegramId: string;
  username: string;
  balance: number;
  gamesPlayed: number;
  gamesWon: number;
  totalWinnings: number;
  language: string;
  createdAt: string;
  updatedAt: string;
}
export async function getOrCreateUser(user: {
  telegramId: string;
  username: string;
  language: string;
}): Promise<User> {
  const userRef = ref(rtdb, `users/${user.telegramId}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    return snapshot.val() as User; // ✅ existing user always matches interface
  }

  // create new user
  const now = new Date().toISOString();
  const newUser: User = {
    telegramId: user.telegramId,
    username: user.username,
    balance: 50,
    gamesPlayed: 0,
    gamesWon: 0,
    totalWinnings: 0,
    language: user.language,
    createdAt: now,
    updatedAt: now,
  };

  await set(userRef, newUser);
  return newUser;
}
