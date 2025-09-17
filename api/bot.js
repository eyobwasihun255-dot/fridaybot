import { ref, get, set, update, push } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js"; 
import fetch from "node-fetch";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => parseInt(id.trim()))
  .filter(Boolean);
// ====================== LANGUAGE HELPER ======================
function t(lang, key,...args) {
const texts = {
en: {
welcome:
"🎯 Welcome to Friday Bingo!\n for any question @Natii4545 \n\nCommands:\n/playgame - Launch game\n/deposit - Add funds\n/withdraw - Withdraw winnings",
choose_lang: "🌍 Please choose your language:",
receipt_used :"Receipt is used !",
play: "🎉 Let’s play Bingo!",
enter_deposit_amount : "Enter amount to Deposit",
deposit_method: "Choose payment method :",
deposit_amount: (method) => `Enter deposit amount for ${method}:`,
deposit_sms: (method) => `📩 Please forward the ${method} SMS receipt after sending the payment to number above.`,
withdraw_amount: "💵 Enter withdrawal amount:",
select_withdraw_method : "Choose payment method:",
withdraw_method: "Select withdrawal method:",
withdraw_cbe: "🏦 Enter your CBE account number:",
withdraw_telebirr: "📱 Enter your Telebirr phone number:",
invalid_amount: "❌ Invalid amount, try again.",
insufficient_balance: "❌ Insufficient balance.",
enter_cbe :"Please Enter you CBE account number :",
no_link: "❌ No link found. Please resend SMS.",
link_used: "⚠️ This receipt/link has already been used. Please send a valid one.",
wait_admin: "⏳ Request sent. Please wait for admin approval.",
approved_deposit: (amt) => `✅ Deposit approved!\n+${amt} birr credited.\n\n🎮 You can now continue playing:\n/playgame`,
declined_deposit: "❌ Your deposit was declined.",
approved_withdraw: (amt, acc) => `✅ Withdraw approved!\n-${amt} birr paid to account: ${acc}\n\n🎮 You can continue playing anytime:\n/playgame`,
declined_withdraw: "❌ Your withdrawal was rejected.",
fallback: "Send /playgame or/deposit or /withdraw to start.",
send_deposit_sms: "📩 Please forward the payment SMS you received.",
enter_telebirr : "Please Enter your Telebirr account Phone number :",
withdraw_pending :"Withdraw pending ...",
admin_declined_withdraw : "❌ Admin declined Request ! ",
admin_approved_withdraw :  "✅ Admin approved Request ! ",
admin_approved_deposit:  "✅ Admin approved Request ! ",
admin_declined_deposit : "❌ Admin declined Request ! ",

},
am: {
welcome:"🎯 Welcom to Friday Bingo!\nለማንኛውም ጥያቄዎች @Natii4545 \n\nትዕዛዞች:\n/playgame - ጨዋታ ጀምር\n/deposit - ገንዘብ ጨምር\n/withdraw - ትርፍ ወስድ",
choose_lang: "🌍 ቋንቋ ይምረጡ:",
receipt_used : "ደረሰኝ ጥቅም ላይ ይውላል!",
admin_declined_withdraw : "❌ Admin ጥያቄውን አልተቀበለውም ! ",
admin_approved_withdraw :  "✅ Admin ጥያቄ ጸድቋል ! ",
admin_approved_deposit:  "✅ Admin ጥያቄ ጸድቋል ! ",
enter_telebirr: "እባክዎን የቴሌቢር ስልክ ቁጥር ያስገቡ፡-",
withdraw_pending:"በመጠባበቅ ላይ ...",
admin_declined_deposit : "❌ Admin declined Request ! ",
play: "🎉 Let’s play Bingo!",
enter_deposit_amount : "የተቀማጭ ገንዘብ መጠን ያስገቡ",
send_deposit_sms: "📩 እባክዎ የተቀበሉትን የክፍያ SMS ያስገቡ",
deposit_method: "የመክፈያ መንገድ ይምረጡ:",
deposit_amount: (method) => `${method} በመክፈል የሚጨምሩትን መጠን ያስገቡ:`,
deposit_sms: (method) => `📩 እባክዎ ከላይ ባለው ${method} ቁጥር ገንዘብ መላኩን ከጨረሱ በኋላ የሚደርሰውን የsms መልእክት ይላኩ።`,
withdraw_amount: "💵 የሚወስዱትን መጠን ያስገቡ:",
select_withdraw_method: "የመክፈያ መንገድ ይምረጡ:",
enter_cbe : "እባክዎን CBE የባንክ ሂሳብ ቁጥርዎን ያስገቡ:",
withdraw_method: "የመክፈያ መንገድ ይምረጡ:",
withdraw_cbe: "🏦 የCBE መለያ ቁጥርዎን ያስገቡ:",
withdraw_telebirr: "📱 የቴሌብር ስልክ ቁጥርዎን ያስገቡ:",
invalid_amount: "❌ ትክክለኛ መጠን ያስገቡ።",
insufficient_balance: "❌ በቂ ቀሪ መጠን የለም።",
no_link: "❌ ምንም ሊንክ አልተገኘም። እባክዎ እንደገና ይላኩ።",
link_used: "⚠️ ይህ ደረሰኝ/ሊንክ አስቀድሞ ተጠቅመዋል። እባክዎ ትክክለኛ ይላኩ።",
wait_admin: "⏳ ጥያቄዎ ተላክ። እባክዎ ይጠብቁ።",
approved_deposit: (amt) => `✅ ተቀብሏል!\n+${amt} ብር ተጨመረ።\n\n🎮 ከዚህ በኋላ መጫወት ትችላላችሁ:\n/playgame`,
declined_deposit: "❌ ቅጽ አልተቀበለም።",
approved_withdraw: (amt, acc) => `✅ መክፈያ ተከናውኗል!\n-${amt} ብር ተከፍሏል ወደ: ${acc}\n\n🎮 እንደገና መጫወት ትችላላችሁ:\n/playgame`,
declined_withdraw: "❌ request declined",
fallback: "Send /playgame or/deposit or /withdraw to start.",
},
};
 const value = texts[lang]?.[key];
  if (typeof value === "function") {
    return value(...args); // pass extra args to the function
  }
  return value || key;
}

// ====================== TELEGRAM HELPERS ======================
async function telegram(method, payload) {
  const url = `https://api.telegram.org/bot${TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
function homeKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: "🏠 Home", callback_data: "go_home" }],
    ],
  };
}


async function sendMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", { chat_id: chatId, text, ...extra });
}

// ====================== USER MANAGEMENT ======================
// ====================== USER MANAGEMENT ======================
// ====================== USER MANAGEMENT ======================
async function registerUserToFirebase(user) {
  const userRef = ref(rtdb, "users/" + user.id);
  const snapshot = await get(userRef);

  if (!snapshot.exists()) {
    const now = new Date().toISOString();

    const newUser = {
      telegramId: user.id.toString(),
      username: user.username || `user_${user.id}`,
      balance: 0,             // initial balance
      gamesPlayed: 0,
      gamesWon: 0,
      totalWinnings: 0,
      lang: "en",              // keep this consistent with rest of code
      createdAt: now,
      updatedAt: now,
    };

    await set(userRef, newUser);
    console.log(`✅ Registered new user: ${user.id} (${newUser.username})`);
  } else {
    const existingUser = snapshot.val();
    console.log(`ℹ️ User already exists: ${user.id} (${existingUser.username}), balance = ${existingUser.balance}`);
  }
}

// ====================== MESSAGE HELPERS ======================
function extractUrlFromText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

// ====================== HANDLERS ======================
async function handleStart(message) {
const chatId = message.chat.id;
await registerUserToFirebase(message.from);


const keyboard = {
inline_keyboard: [
[{ text: "English 🇬🇧", callback_data: "lang_en" }],
[{ text: "አማርኛ 🇪🇹", callback_data: "lang_am" }],
],
};


await sendMessage(chatId, t("en", "choose_lang"), { reply_markup: keyboard });
}


import crypto from "crypto";

async function handlePlaygame(message) {
  const chatId = message.chat.id;
  const telegramId = String(message.from.id);

  // ✅ Sign Telegram ID
  const secret = process.env.TELEGRAM_BOT_TOKEN;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(telegramId)
    .digest("hex");

  // Build signed URL
  const baseUrl = process.env.WEBAPP_URL || "https://fridaybots.vercel.app";
  const webAppUrl = `${baseUrl}?id=${telegramId}&sig=${sig}`;

  // Ensure user exists in RTDB (your existing logic)
  const userRef = ref(rtdb, `users/${telegramId}`);
  const userSnap = await get(userRef);
  if (!userSnap.exists()) {
    const user = {
      telegramId,
      username: message.from.username || message.from.first_name || `user_${telegramId}`,
      balance: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      totalWinnings: 0,
      language: "am",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await set(userRef, user);
  }

  // Send signed webapp button
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "🎮 Open Friday Bingo",
          web_app: { url: webAppUrl },
        },
      ],
    ],
  };

  await sendMessage(chatId, t("am", "play"), { reply_markup: keyboard });
}



async function handleDeposit(message) {
const chatId = message.chat.id;
const userRef = ref(rtdb, "users/" + message.from.id);
const userSnap = await get(userRef);
const user = userSnap.val();
const lang = user?.lang || "en";


const keyboard = {
inline_keyboard: [
[{ text: "📱 CBE Mobile Banking", callback_data: "deposit_cbe" }],
[{ text: "💳 Telebirr", callback_data: "deposit_telebirr" }],
],
};
await sendMessage(chatId, t(lang, "deposit_method"), { reply_markup: keyboard });
}


async function handleWithdraw(message) {
const chatId = message.chat.id;
const userRef = ref(rtdb, "users/" + message.from.id);
const userSnap = await get(userRef);
const user = userSnap.val();
const lang = user?.lang || "en";


await sendMessage(chatId, t(lang, "withdraw_amount"));
pendingActions.set(message.from.id, { type: "awaiting_withdraw_amount" });
}



// ====================== STATE MACHINE ======================
const pendingActions = new Map();
const depositRequests = new Map();
const withdrawalRequests = new Map();

// ====================== USER MESSAGES ======================
async function handleUserMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;
  const userRef = ref(rtdb, "users/" + userId);
  const userSnap = await get(userRef);
  const user = userSnap.val();
  const lang = user?.lang || "en"; // default English

  // ====================== COMMANDS FIRST ======================
  if (text === "/start") return handleStart(message);
  if (text === "/deposit") return handleDeposit(message);
  if (text === "/withdraw") return handleWithdraw(message);
  if (text === "/playgame") return handlePlaygame(message);

  const pending = pendingActions.get(userId);

  // ====================== DEPOSIT AMOUNT STEP ======================
  if (pending?.type === "awaiting_deposit_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await sendMessage(chatId, t(lang, "invalid_amount"));
      return;
    }

    pendingActions.set(userId, { 
      type: "awaiting_deposit_sms", 
      method: pending.method, 
      amount 
    });

  await sendMessage(chatId, t(lang, "deposit_sms", pending.method));

    return;
  }

  // ====================== DEPOSIT SMS STEP ======================
  if (pending?.type === "awaiting_deposit_sms") {
    const url = extractUrlFromText(text);
    if (!url) {
      await sendMessage(chatId, t(lang, "no_link"));
      return;
    }

    // ✅ Check if URL already exists in deposits
    const depositsRef = ref(rtdb, "deposits");
    const snap = await get(depositsRef);
    if (snap.exists()) {
      const deposits = snap.val();
      const alreadyUsed = Object.values(deposits).some(d => d.url === url);
      if (alreadyUsed) {
        await sendMessage(chatId, t(lang, "receipt_used"));
        pendingActions.delete(userId);
        return;
      }
    }

    const requestId = `dep_${userId}_${Date.now()}`;
    depositRequests.set(requestId, { 
      userId, 
      amount: pending.amount, 
      url, 
      smsText: text,   // full SMS text
      method: pending.method, 
      status: "pending" 
    });

    ADMIN_IDS.forEach(adminId => {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve_deposit_${requestId}` },
            { text: "❌ Decline", callback_data: `decline_deposit_${requestId}` },
          ],
        ],
      };

      sendMessage(
        adminId, 
        `💵 Deposit request:\n` +
        `👤 @${user?.username || userId}\n` +
        `Method: ${pending.method}\n` +
        `Amount: ${pending.amount}\n\n` +
        `📩 SMS:\n${text}\n\n` +
        `🔗 Extracted link: ${url}`, 
        { reply_markup: keyboard }
      );
    });

    await sendMessage(chatId, t(lang, "deposit_pending"));
    pendingActions.delete(userId);
    return;
  }

  // ====================== WITHDRAW AMOUNT STEP ======================
  if (pending?.type === "awaiting_withdraw_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await sendMessage(chatId, t(lang, "invalid_amount"));
      return;
    }

    if (amount > user.balance) {
      await sendMessage(chatId, t(lang, "insufficient_balance"));
      pendingActions.delete(userId);
      return;
    }

    // ✅ Ask method next
    const keyboard = {
      inline_keyboard: [
        [{ text: "🏦 CBE", callback_data: "withdraw_cbe" }],
        [{ text: "📱 Telebirr", callback_data: "withdraw_telebirr" }],
      ],
    };

    await sendMessage(chatId, t(lang, "select_withdraw_method"), { reply_markup: keyboard });
    pendingActions.set(userId, { type: "awaiting_withdraw_method", amount });
    return;
  }

  // ====================== WITHDRAW ACCOUNT STEP ======================
  if (pending?.type === "awaiting_withdraw_account") {
    const requestId = `wd_${userId}_${Date.now()}`;
    withdrawalRequests.set(requestId, {
      userId,
      amount: pending.amount,
      method: pending.method,
      account: text,
      status: "pending",
    });

    ADMIN_IDS.forEach((adminId) => {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `approve_withdraw_${requestId}` },
            { text: "❌ Reject", callback_data: `decline_withdraw_${requestId}` },
          ],
        ],
      };

      sendMessage(
        adminId,
        `💸 Withdrawal request:\n` +
          `👤 @${user?.username || userId}\n` +
          `Method: ${pending.method}\n` +
          `Amount: ${pending.amount}\n` +
          `Account/Phone: ${text}`,
        { reply_markup: keyboard }
      );
    });

    await sendMessage(chatId, t(lang, "withdraw_pending"));
    pendingActions.delete(userId);
    return;
  }
  if (text.startsWith("/player")) {
  if (!ADMIN_IDS.includes(userId)) {
    await sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  await sendMessage(chatId, "🔎 Enter the Telegram ID or username of the player:");
  pendingActions.set(userId, { type: "awaiting_player_lookup" });
  return;}
if (pending?.type === "awaiting_player_lookup") {
  const id = text.replace("@", "").trim();

  try {
    const response = await fetch(`${process.env.WEBAPP_URL}/api/player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) {
      await sendMessage(chatId, "❌ Player not found.");
      pendingActions.delete(userId);
      return;
    }

    const playerData = await response.json();

    const info = `
👤 Username: ${playerData.username}
🆔 Telegram ID: ${playerData.telegramId}
💰 Balance: ${playerData.balance}
🎮 Games Played: ${playerData.gamesPlayed}
🏆 Games Won: ${playerData.gamesWon}
💵 Total Winnings: ${playerData.totalWinnings}
💳 Total Deposits: ${playerData.totalDeposits}
📉 Total Losses: ${playerData.totalLosses}
🗓 Created At: ${playerData.createdAt}
🗓 Updated At: ${playerData.updatedAt}
    `;

    await sendMessage(chatId, info);
  } catch (err) {
    console.error("Error fetching player:", err);
    await sendMessage(chatId, "❌ Failed to fetch player data.");
  }

  pendingActions.delete(userId);
  return;
}

if (text === "/revenue") {
  if (!ADMIN_IDS.includes(userId)) {
    await sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  try {
    const response = await fetch(`${process.env.WEBAPP_URL}/api/revenue`);
    if (!response.ok) throw new Error("Failed to fetch revenue");

    const data = await response.json();

    // Prepare readable report
    let report = "💰 Revenue Report 💰\n\n";

    // 1️⃣ Revenue by Date
    report += "📅 Total Revenue By Date:\n";
    for (const [date, amount] of Object.entries(data.totalByDate)) {
      report += `• ${date}: $${amount}\n`;
    }

    // 2️⃣ Total Undrawned Revenue
    report += `\n⏳ Total Undrawned Revenue: $${data.undrawnedTotal}\n`;

    await sendMessage(chatId, report);
  } catch (err) {
    console.error("Error fetching revenue:", err);
    await sendMessage(chatId, "❌ Failed to fetch revenue data.");
  }

  return;
}
if (text === "/profit") {
  if (!ADMIN_IDS.includes(userId)) {
    await sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  // Step 1: Ask for passcode
  await sendMessage(chatId, "🔐 Enter admin passcode to confirm revenue withdrawal:");
  pendingActions.set(userId, { type: "awaiting_revenue_passcode" });
  return;
}

// Step 2: Handle passcode
if (pending?.type === "awaiting_revenue_passcode") {
  const passcode = "19991999"; // <-- your secure passcode
  if (text !== passcode) {
    await sendMessage(chatId, "❌ Incorrect passcode. Process cancelled.");
    pendingActions.delete(userId);
    return;
  }

  await sendMessage(chatId, "💰 Passcode verified. Enter the amount to withdraw:");
  pendingActions.set(userId, { type: "awaiting_revenue_amount" });
  return;
}

// Step 3: Handle amount
if (pending?.type === "awaiting_revenue_amount") {
  const amountToWithdraw = parseFloat(text);
  if (isNaN(amountToWithdraw) || amountToWithdraw <= 0) {
    await sendMessage(chatId, "❌ Invalid amount. Process cancelled.");
    pendingActions.delete(userId);
    return;
  }

  try {
    // Fetch current revenue data
    const response = await fetch(`${process.env.WEBAPP_URL}/api/revenue`);
    if (!response.ok) throw new Error("Failed to fetch revenue");

    const data = await response.json();

    // Check if withdrawal amount exceeds total undrawned revenue
    if (amountToWithdraw > data.undrawnedTotal) {
      await sendMessage(chatId, `❌ Amount exceeds total undrawned revenue ($${data.undrawnedTotal})`);
      pendingActions.delete(userId);
      return;
    }

    // ✅ Process undrawned entries
    let remaining = amountToWithdraw;
    const updatedEntries = [];
    const updates = {};

    for (const entry of data.undrawnedDetails) {
      if (!entry.drawned && remaining > 0) {
        const take = Math.min(remaining, entry.amount);
        remaining -= take;

        // Update entry as drawned in RTDB
        updates[`revenue/${entry.gameId}/drawned`] = true;
        updatedEntries.push(entry.gameId);

        if (remaining <= 0) break;
      }
    }

    // Save withdrawal record
    const withdrawalRef = ref(rtdb, `revenueWithdrawals/${Date.now()}`);
    await set(withdrawalRef, {
      adminId: userId,
      amount: amountToWithdraw,
      date: Date.now(),
    });

    // Update undrawned entries in RTDB
    const revenueRef = ref(rtdb);
    await update(revenueRef, updates);

    await sendMessage(chatId, `✅ Revenue withdrawal of $${amountToWithdraw} successful!`);
  } catch (err) {
    console.error("Error withdrawing revenue:", err);
    await sendMessage(chatId, "❌ Failed to process revenue withdrawal.");
  }

  pendingActions.delete(userId);
  return;
}


  // ====================== FALLBACK ======================
  await sendMessage(chatId, t(lang, "fallback"));
}

// ====================== CALLBACKS ======================
async function handleCallback(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const userRef = ref(rtdb, "users/" + userId);
  const userSnap = await get(userRef);
  const user = userSnap.val();
  const lang = user?.lang || "en";

  // ================== LANGUAGE TOGGLE ==================
  if (data === "lang_en" || data === "lang_am") {
    const lang = data === "lang_en" ? "en" : "am";
    await update(userRef, { lang });
    await sendMessage(chatId, t(lang, "welcome"));
    return;
  }
if (data === "deposit_cbe" || data === "deposit_telebirr") {
  const method = data === "deposit_cbe" ? "CBE" : "Telebirr";

  // Save deposit method
  pendingActions.set(userId, { type: "awaiting_deposit_amount", method });

  // Account details
  const accountDetails = method === "CBE"
    ? { accNumber: "በቅርቡ ይጠብቁ", accHolder: "Friday Bingo" }
    : { phone: "0948404314", holder: "Mare" };

  // Escape Markdown special chars
  const escapeMD = (text) => text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");

  const infoText =
    method === "CBE"
      ? `💳 *Deposit to CBE Account:*\n\`\`\`\n${escapeMD(accountDetails.accNumber)}\n\`\`\`\n*Account Holder:* ${escapeMD(accountDetails.accHolder)}\n\n💰 የሚጨምሩትን መጠን ያስገቡ:`
      : `📱 *Deposit via Telebirr:*\n\`\`\`\n${escapeMD(accountDetails.phone)}\n\`\`\`\n*የተቀባዩ ስም :* ${escapeMD(accountDetails.holder)}\n\n💰 የሚጨምሩትን መጠን ያስገቡ:`;

  await sendMessage(chatId, infoText, { parse_mode: "MarkdownV2" });
  return;
}




  if (data.startsWith("approve_deposit_")) {
    const requestId = data.replace("approve_deposit_", "");
    const req = depositRequests.get(requestId);
    if (!req) return;

    const userRef = ref(rtdb, "users/" + req.userId);
    const snap = await get(userRef);
    if (snap.exists()) {
      const user = snap.val();
      const newBalance = (user.balance || 0) + req.amount;
      await update(userRef, { balance: newBalance });

      // ✅ Save receipt
      const depositId = `dep_${Date.now()}`;
      const depositRef = ref(rtdb, `deposits/${depositId}`);
      await set(depositRef, {
        userId: req.userId,
        username: user.username || req.userId,
        amount: req.amount,
        url: req.url,
        smsText: req.smsText,
        method: req.method,
        date: new Date().toISOString(),
      });

      // Notify player
      await sendMessage(req.userId, t(lang, "approved_deposit", req.amount));
      // Notify admin
      await sendMessage(chatId, t(lang, "admin_approved_deposit", `@${user.username || req.userId}`, req.amount));
    }
    depositRequests.delete(requestId);
    return;
  }

  if (data.startsWith("decline_deposit_")) {
    const requestId = data.replace("decline_deposit_", "");
    const req = depositRequests.get(requestId);
    if (!req) return;

    await sendMessage(req.userId, t(lang, "declined_deposit"));
    await sendMessage(chatId, t(lang, "admin_declined_deposit", `@${req.userId}`, req.amount));
    depositRequests.delete(requestId);
    return;
  }

  // ================== WITHDRAW ==================
  if (data === "withdraw_cbe" || data === "withdraw_telebirr") {
    const pending = pendingActions.get(userId);
    if (!pending || pending.type !== "awaiting_withdraw_method") return;

    const method = data === "withdraw_cbe" ? "CBE" : "Telebirr";
    pendingActions.set(userId, { type: "awaiting_withdraw_account", amount: pending.amount, method });

    if (method === "CBE") {
      await sendMessage(chatId, t(lang, "enter_cbe"));
    } else {
      await sendMessage(chatId, t(lang, "enter_telebirr"));
    }
    return;
  }

  if (data.startsWith("approve_withdraw_")) {
    const requestId = data.replace("approve_withdraw_", "");
    const req = withdrawalRequests.get(requestId);
    if (!req) return;

    const userRef = ref(rtdb, "users/" + req.userId);
    const snap = await get(userRef);
    if (snap.exists()) {
      const user = snap.val();
      const newBalance = (user.balance || 0) - req.amount;
      await update(userRef, { balance: newBalance });
      const withdrawRef = ref(rtdb, "withdrawals");
    await push(withdrawRef, {
      userId: req.userId,
      amount: req.amount,
      account: req.account,
      date: new Date().toISOString(), // store date in ISO format
      status: "approved", // you can also track "pending", "rejected", etc.
    });
      await sendMessage(req.userId, t(lang, "approved_withdraw", req.amount, req.account));
      await sendMessage(chatId, t(lang, "admin_approved_withdraw", `@${user.username || req.userId}`, req.amount));
    }
    withdrawalRequests.delete(requestId);
    return;
  }

  if (data.startsWith("decline_withdraw_")) {
    const requestId = data.replace("decline_withdraw_", "");
    const req = withdrawalRequests.get(requestId);
    if (!req) return;

    await sendMessage(req.userId, t(lang, "declined_withdraw"));
    await sendMessage(chatId, t(lang, "admin_declined_withdraw", `@${req.userId}`, req.amount));
    withdrawalRequests.delete(requestId);
    return;
  }

  telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id });
}


// ====================== MAIN HANDLER ======================
export default async function handler(req, res) {
  if (req.method === "POST") {
    const update = req.body;
    if (update.message) await handleUserMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
    return res.json({ ok: true });
  }
  res.status(200).json({ status: "Bot running" });
}
