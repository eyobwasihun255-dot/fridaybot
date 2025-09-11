
 // ✅ import your interface
 import { ref, get as dbGet, set as dbSet } from "firebase/database";
import { rtdb } from "../firebase/config";


interface User {
  telegramId: string;
  username: string;
  balance: number;
  lang: string;

}
export async function getOrCreateUser(user: { telegramId: string; username: string; lang: string }) {
  console.log('Getting/creating user:', user); // Debug log
  const userRef = ref(rtdb, `users/${user.telegramId}`);
  const snapshot = await dbGet(userRef);

  if (snapshot.exists()) {
    // ✅ Return existing user (preserve balance)
    const existingUser = snapshot.val();
    console.log('Found existing user:', existingUser); // Debug log
    return existingUser;
  } else {
    const newUser = {
      telegramId: user.telegramId,
      username: user.username,
      balance: 100, // start balance (example)
      lang: user.lang,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    console.log('Creating new user:', newUser); // Debug log
    await dbSet(userRef, newUser);
    return newUser;
  }
}
