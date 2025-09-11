import { rtdb } from "../firebase/config";
import { ref, get, set } from "firebase/database";
 // ✅ import your interface

interface User {
  telegramId: string;
  username: string;
  balance: number;
  lang: string;
  createdAt: string;
  updatedAt: string;
}
export async function getOrCreateUser(user: {
  telegramId: string;
  username: string;
  lang: string;
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
    lang: user.lang,
    createdAt: now,
    updatedAt: now,
  };

  await set(userRef, newUser);
  return newUser;
}
