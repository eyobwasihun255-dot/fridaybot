// services/firebaseApi.ts
import { ref, get as dbGet, set as dbSet } from "firebase/database";
import { rtdb } from "../firebase/config";

export async function getOrCreateUser({
  telegramId,
  username,
  lang = "am",
}: {
  telegramId: string;
  username: string;
  lang?: string;
}) {
  const userRef = ref(rtdb, `users/${telegramId}`);
  const snap = await dbGet(userRef);

  if (snap.exists()) {
    const val = snap.val();
    // ensure fields are present
    return {
      telegramId: val.telegramId ?? telegramId,
      username: val.username ?? username,
      balance: typeof val.balance === "number" ? val.balance : Number(val.balance ?? 0),
      lang: val.lang ?? lang,
      createdAt: val.createdAt ?? new Date().toISOString(),
      updatedAt: val.updatedAt ?? new Date().toISOString(),
    };
  } else {
    const newUser = {
      telegramId,
      username,
      balance: 100, // starting balance if you want
      lang,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await dbSet(userRef, newUser);
    return newUser;
  }
}
