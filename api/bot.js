import { ref, get, set, update, push , remove, runTransaction } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js"; 
import fetch from "node-fetch";


const ADMIN_PASSCODE = "19991999"; // Ideally move to process.env.ADMIN_PASSCODE
const CLEANUP_HOURS = 6;
const CLEANUP_MS = CLEANUP_HOURS * 60 * 60 * 1000;

// Utility: Cleanup old deposits & withdrawals
async function cleanupOldTransactions() {
  const now = Date.now();
  const deleteIfOld = async (nodePath) => {
    try {
      const nodeRef = ref(rtdb, nodePath);
      const snap = await get(nodeRef);

      if (snap.exists()) {
        const data = snap.val();
        let deletedCount = 0;

        for (const [id, record] of Object.entries(data)) {
          if (record.date && now - record.date > CLEANUP_MS) {
            await remove(ref(rtdb, `${nodePath}/${id}`));
            deletedCount++;
          }
        }

        if (deletedCount > 0) {
          console.log(`🧹 Deleted ${deletedCount} old records from ${nodePath}`);
        }
      }
    } catch (err) {
      console.error(`❌ Cleanup error in ${nodePath}:`, err);
    }
  };
  await deleteIfOld("winningHistory");
  await deleteIfOld("withdrawals");
}
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
fallback: "Send /playgame or /deposit or /withdraw to start.",
send_deposit_sms: "📩 Please forward the payment SMS you received.",
enter_telebirr : "Please Enter your Telebirr account Phone number :",
withdraw_pending :"Withdraw pending ...",
admin_declined_withdraw : "❌ Admin declined Request ! ",
admin_approved_withdraw :  "✅ Admin approved Request ! ",
admin_approved_deposit:  "✅ Admin approved Request ! ",
admin_declined_deposit : "❌ Admin declined Request ! ",
star_bingo:"Start bingo game",
withdraw : "Withdraw",
deposit : "Deposit",
help : "Help",
help_text: `
🎮 *How to Play Bingo*

1️⃣ Use /deposit to add balance.  
2️⃣ Use /playgame to join a room.  
3️⃣ Wait until enough players join.  
4️⃣ Numbers will be drawn automatically.  
5️⃣ Tap numbers on your card when drawn.  
6️⃣ If you complete a the winning pattern → You win!  
7️⃣ Use /withdraw to cash out your winnings.

Good luck and have fun 🎉`,
},
am: {
  start_bingo:"ቢንጎ ጨዋታ  ጀምር ",
  withdraw : "ገንዘብ ለማውጣት",
  deposit : "ገንዘብ ለመጨመር",
  help : "መመሪያ",
  help_text: `
🎮 *ቢንጎ እንዴት እንደሚጫወት*

1️⃣ /deposit በመጠቀም በአካውንትዎ ገንዘብ ያክሉ።  
2️⃣ /playgame በመጠቀም ወደ ክፍል ይግቡ።  
3️⃣ በቂ ተጫዋቾች እስኪገቡ ይጠብቁ።  
4️⃣ ቁጥሮች በራስ-ሰር ይተላለፋሉ።  
5️⃣ በካርድዎ ላይ የተሰየመውን ቁጥር ይነኩ።  
6️⃣ /withdraw በመጠቀም ማሸነፍዎን ያውጡ።

መልካም እድል 🍀
    `,
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
fallback: "Send /playgame or /deposit or /withdraw to start.",
},
};
 const value = texts[lang]?.[key];
  if (typeof value === "function") {
    return value(...args); // pass extra args to the function
  }
  return value || key;
}

// ====================== TELEGRAM HELPERS ======================
async function telegram(method, payload, retries = 3) {
  const url = `https://api.telegram.org/bot${TOKEN}/${method}`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10-second timeout

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        
        // Don't retry for certain error codes
        if (res.status === 400 || res.status === 403 || res.status === 404) {
          console.warn(`⚠️ Telegram API error (non-retryable): ${res.status} - ${text}`);
          return { ok: false, error: text };
        }
        
        // Retry for server errors and network issues
        if (attempt < retries) {
          console.warn(`⚠️ Telegram API error (attempt ${attempt}/${retries}): ${res.status} - ${text}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
          continue;
        }
        
        console.warn(`⚠️ Telegram API error (final attempt): ${res.status} - ${text}`);
        return { ok: false, error: text };
      }

      return await res.json();
    } catch (err) {
      // Don't retry for certain network errors
      if (err.name === 'AbortError' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        console.error(`❌ Telegram network error (non-retryable):`, err.message);
        return { ok: false, error: err.message };
      }
      
      // Retry for timeout and other network issues
      if (attempt < retries) {
        console.warn(`⚠️ Telegram network error (attempt ${attempt}/${retries}):`, err.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        continue;
      }
      
      console.error(`❌ Telegram network error (final attempt):`, err.message);
      return { ok: false, error: err.message };
    }
  }
}
function homeKeyboard(lang) {
  return {
    inline_keyboard: [
      [{ text: "🏠 Home", callback_data: "go_home" }],
    ],
  };
}



async function sendMessage(chatId, text, extra = {}) {
  try {
    const result = await telegram("sendMessage", { chat_id: chatId, text, ...extra });
    if (!result.ok) {
      console.warn(`⚠️ Failed to send Telegram message to ${chatId}:`, result.error);
    }
  } catch (err) {
    console.error(`❌ sendMessage exception:`, err.message);
    // Do nothing — game logic continues unaffected
  }
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
      balance: 10,             // initial balance
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


 sendMessage(chatId, t("en", "choose_lang"), { reply_markup: keyboard });
}


import crypto from "crypto";
const API = `https://api.telegram.org/bot${TOKEN}`;
const commands = [
  { command: "playgame", description: t("am", "start_bingo") },
  { command: "deposit", description:  t("am", "deposit") },
  { command: "withdraw", description:  t("am", "withdraw") },
  { command: "help", description: t("am", "help") },
];

// Register the commands with Telegram
async function setCommands() {
  const response = await fetch(`${API}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });

  const data = await response.json();
  console.log("Set Commands Response:", data);
}

setCommands();
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
  const baseUrl = process.env.WEBAPP_URL || "https://fridaybot-9jrb.onrender.com/";
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

   sendMessage(chatId, t("am", "play"), { reply_markup: keyboard });
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
sendMessage(chatId, t(lang, "deposit_method"), { reply_markup: keyboard });
}


async function handleWithdraw(message) {
const chatId = message.chat.id;
const userRef = ref(rtdb, "users/" + message.from.id);
const userSnap = await get(userRef);
const user = userSnap.val();
const lang = user?.lang || "en";


sendMessage(chatId, t(lang, "withdraw_amount"));
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

  // Detect message type
  const hasText = !!message.text;
  const hasPhoto = !!message.photo;
  const hasDocument = !!message.document;
  const hasCaption = !!message.caption;

  // Get current pending action
  const pending = pendingActions.get(userId);

  // Allow media if admin is in /sendmessage mode
  const isBroadcastMedia =
    pending?.type === "awaiting_send_content" &&
    (hasPhoto || hasDocument);

  // If message is neither text nor allowed media, ignore
  if (!hasText && !isBroadcastMedia) {
    console.log(`⚠️ Ignored non-text message from user ${userId}`);
    return;
  }

  // Extract text safely
  const text = message.text?.trim() || message.caption?.trim() || "";

  const userRef = ref(rtdb, "users/" + userId);
  const userSnap = await get(userRef);
  const user = userSnap.val();
  const lang = user?.lang || "en";


  // ====================== COMMANDS FIRST ======================
  if (text === "/start") return handleStart(message);
  if (text === "/deposit") return handleDeposit(message);
  if (text === "/withdraw") return handleWithdraw(message);
  if (text === "/playgame") return handlePlaygame(message);

  

// Define your commands


  // ====================== DEPOSIT AMOUNT STEP ======================
  if (pending?.type === "awaiting_deposit_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      sendMessage(chatId, t(lang, "invalid_amount"));
      return;
    }

    pendingActions.set(userId, { 
      type: "awaiting_deposit_sms", 
      method: pending.method, 
      amount 
    });

  sendMessage(chatId, t(lang, "deposit_sms", pending.method));

    return;
  }

  // ====================== DEPOSIT SMS STEP ======================
  if (pending?.type === "awaiting_deposit_sms") {
    const url = extractUrlFromText(text);
    if (!url) {
      sendMessage(chatId, t(lang, "no_link"));
      return;
    }

    // ✅ Check if URL already exists in deposits
    const depositsRef = ref(rtdb, "deposits");
    const snap = await get(depositsRef);
    if (snap.exists()) {
      const deposits = snap.val();
      const alreadyUsed = Object.values(deposits).some(d => d.url === url);
      if (alreadyUsed) {
        sendMessage(chatId, t(lang, "receipt_used"));
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

    sendMessage(chatId, t(lang, "deposit_pending"));
    pendingActions.delete(userId);
    return;
  }
  if (text === "/help") {
  sendMessage(chatId, t(lang, "help_text"), { parse_mode: "Markdown" });
  return;
}

  // ====================== WITHDRAW AMOUNT STEP ======================
  if (pending?.type === "awaiting_withdraw_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      sendMessage(chatId, t(lang, "invalid_amount"));
      return;
    }
  
    // 🔒 Minimum withdrawal amount check
    if (amount < 50) {
      sendMessage(chatId, "⚠️ Minimum withdrawal is 50 birr.");
      pendingActions.delete(userId);
      return;
    }
  
    if (amount > user.balance) {
      sendMessage(chatId, t(lang, "insufficient_balance"));
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
  
    sendMessage(chatId, t(lang, "select_withdraw_method"), { reply_markup: keyboard });
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

    sendMessage(chatId, t(lang, "withdraw_pending"));
    pendingActions.delete(userId);
    return;
  }
  if (text.startsWith("/player")) {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🔎 Enter the Telegram ID or username of the player:");
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
      sendMessage(chatId, "❌ Player not found.");
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

    sendMessage(chatId, info);
  } catch (err) {
    console.error("Error fetching player:", err);
    sendMessage(chatId, "❌ Failed to fetch player data.");
  }

  pendingActions.delete(userId);
  return;
}

if (text === "/revenue") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
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

    sendMessage(chatId, report);
  } catch (err) {
    console.error("Error fetching revenue:", err);
    sendMessage(chatId, "❌ Failed to fetch revenue data.");
  }

  return;
}
if (text === "/profit") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🔐 Enter admin passcode to confirm revenue withdrawal:");
  pendingActions.set(userId, { type: "awaiting_revenue_passcode" });
  return;
}

// Step 2: Verify passcode
if (pending?.type === "awaiting_revenue_passcode") {
  if (text !== ADMIN_PASSCODE) {
    sendMessage(chatId, "❌ Incorrect passcode. Process cancelled.");
    pendingActions.delete(userId);
    return;
  }

  sendMessage(chatId, "💰 Passcode verified. Enter the amount to withdraw:");
  pendingActions.set(userId, { type: "awaiting_revenue_amount" });
  return;
}

// Step 3: Process withdrawal
if (pending?.type === "awaiting_revenue_amount") {
  let requestedAmount = parseFloat(text);
  if (isNaN(requestedAmount) || requestedAmount <= 0) {
    sendMessage(chatId, "❌ Invalid amount. Process cancelled.");
    pendingActions.delete(userId);
    return;
  }

  try {
    const response = await fetch(`${process.env.WEBAPP_URL}/api/revenue`);
    if (!response.ok) throw new Error("Failed to fetch revenue");

    const data = await response.json();

    let remaining = requestedAmount;
    let actualWithdrawn = 0; // total amount we can actually withdraw
    const updates = {};

    for (const entry of data.undrawnedDetails) {
      if (entry.drawned) continue;

      // Only take full entries that fit into the remaining amount
      if (entry.amount <= remaining) {
        updates[`revenue/${entry.gameId}/drawned`] = true;
        remaining -= entry.amount;
        actualWithdrawn += entry.amount;
      }
      // Skip entries that would partially fit
    }

    if (actualWithdrawn === 0) {
      sendMessage(chatId, `❌ Cannot withdraw any full undrawned revenue entries for $${requestedAmount}`);
      pendingActions.delete(userId);
      return;
    }

    // Save withdrawal record
    const withdrawalRef = ref(rtdb, `revenueWithdrawals/${Date.now()}`);
    await set(withdrawalRef, {
      adminId: userId,
      amount: actualWithdrawn,
      date: Date.now(),
    });

    // Update revenue entries
    const revenueRef = ref(rtdb);
    await update(revenueRef, updates);

    await cleanupOldTransactions();

    sendMessage(chatId, `✅ Revenue withdrawal of $${actualWithdrawn} successful!`);
    console.log(`💸 Admin ${userId} withdrew $${actualWithdrawn}`);

  } catch (err) {
    console.error("Error withdrawing revenue:", err);
    sendMessage(chatId, "❌ Failed to process revenue withdrawal.");
  }

  pendingActions.delete(userId);
  return;
}

// ====================== /SENDMESSAGE COMMAND ======================
if (text === "/sendmessage") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(
    chatId,
    "📤 Enter the username (without @), Telegram ID, or type 'all' to message everyone.\n\nYou can send text or media next."
  );
  pendingActions.set(userId, { type: "awaiting_send_target" });
  return;
}

if (pending?.type === "awaiting_send_target") {
  const target = text.trim();
  pendingActions.set(userId, { type: "awaiting_send_content", target });
  sendMessage(chatId, "💬 Now send the message — text, photo, or file:");
  return;
}

if (pending?.type === "awaiting_send_content") {
  const { target } = pending;
  let success = 0, failed = 0;

  // Extract the content type (text/photo/document)
  const content = message.photo
    ? { type: "photo", file_id: message.photo.at(-1).file_id, caption: message.caption || "" }
    : message.document
    ? { type: "document", file_id: message.document.file_id, caption: message.caption || "" }
    : message.text
    ? { type: "text", text: message.text }
    : null;

  if (!content) {
    sendMessage(chatId, "⚠️ Unsupported content type. Send text, photo, or document.");
    return;
  }

  try {
    if (target.toLowerCase() === "all") {
      const usersSnap = await get(ref(rtdb, "users"));
      if (!usersSnap.exists()) {
        sendMessage(chatId, "⚠️ No users found.");
      } else {
        const users = usersSnap.val();
        for (const userData of Object.values(users)) {
          try {
            if (content.type === "text") {
              sendMessage(userData.telegramId, content.text);
            } else if (content.type === "photo") {
              await telegram("sendPhoto", {
                chat_id: userData.telegramId,
                photo: content.file_id,
                caption: content.caption,
              });
            } else if (content.type === "document") {
              await telegram("sendDocument", {
                chat_id: userData.telegramId,
                document: content.file_id,
                caption: content.caption,
              });
            }
            success++;
          } catch {
            failed++;
          }
        }
        sendMessage(chatId, `✅ Broadcast done.\nSent: ${success}\nFailed: ${failed}`);
      }
    } else {
      let targetId = target;
      if (isNaN(target)) {
        const usersSnap = await get(ref(rtdb, "users"));
        const users = usersSnap.exists() ? usersSnap.val() : {};
        const user = Object.values(users).find(
          u => (u.username || "").toLowerCase() === target.toLowerCase()
        );
        if (!user) {
          sendMessage(chatId, "❌ Username not found.");
          pendingActions.delete(userId);
          return;
        }
        targetId = user.telegramId;
      }

      if (content.type === "text") {
        sendMessage(targetId, content.text);
      } else if (content.type === "photo") {
        await telegram("sendPhoto", {
          chat_id: targetId,
          photo: content.file_id,
          caption: content.caption,
        });
      } else if (content.type === "document") {
        await telegram("sendDocument", {
          chat_id: targetId,
          document: content.file_id,
          caption: content.caption,
        });
      }

      sendMessage(chatId, `✅ Message sent to ${target}`);
    }
  } catch (err) {
    console.error("Error sending broadcast:", err);
    sendMessage(chatId, "❌ Failed to send message.");
  }

  pendingActions.delete(userId);
  return;
}
// ====================== /REFILL COMMAND ======================
if (text === "/refill") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "💳 Enter the Telegram ID to refill, or type 'all' to refill demo accounts:");
  pendingActions.set(userId, { type: "awaiting_refill_target" });
  return;
}

// Step 2: Get target ID or "all"
if (pending?.type === "awaiting_refill_target") {
  const target = text.trim();

  if (target.toLowerCase() === "all") {
    sendMessage(chatId, "🔢 Enter how many demo accounts to refill:");
    pendingActions.set(userId, { type: "awaiting_refill_demo_count" });
  } else {
    sendMessage(chatId, "💰 Enter the amount to add to this user's balance:");
    pendingActions.set(userId, { type: "awaiting_refill_amount_single", target });
  }
  return;
}

// Step 3a: If target was 'all', get number of demo accounts
if (pending?.type === "awaiting_refill_demo_count") {
  const demoCount = parseInt(text.trim());
  if (isNaN(demoCount) || demoCount <= 0) {
    sendMessage(chatId, "❌ Invalid number. Please enter a positive number.");
    return;
  }

  sendMessage(chatId, "💰 Enter the refill amount for each demo account:");
  pendingActions.set(userId, { type: "awaiting_refill_demo_amount", demoCount });
  return;
}

// Step 3b: If target was single user, get amount
if (pending?.type === "awaiting_refill_amount_single") {
  const amount = parseFloat(text.trim());
  if (isNaN(amount) || amount <= 0) {
    sendMessage(chatId, "❌ Invalid amount. Please enter a positive number.");
    return;
  }

  const targetId = pending.target.trim();

  try {
    const userRef = ref(rtdb, `users/${targetId}`);
    const userSnap = await get(userRef);

    if (!userSnap.exists()) {
      sendMessage(chatId, "❌ User not found.");
      pendingActions.delete(userId);
      return;
    }

    const user = userSnap.val();
    const newBalance = (user.balance || 0) + amount;

    await update(userRef, { balance: newBalance, updatedAt: new Date().toISOString() });
    sendMessage(chatId, `✅ Refilled ${amount} birr for user @${user.username || targetId}.`);
  } catch (err) {
    console.error("Error during single refill:", err);
    sendMessage(chatId, "❌ Failed to refill balance. Check logs for details.");
  }

  pendingActions.delete(userId);
  return;
}

// Step 4: Process "all" refill
if (pending?.type === "awaiting_refill_demo_amount") {
  const amount = parseFloat(text.trim());
  if (isNaN(amount) || amount <= 0) {
    sendMessage(chatId, "❌ Invalid amount. Please enter a positive number.");
    return;
  }

  const { demoCount } = pending;

  try {
    const usersSnap = await get(ref(rtdb, "users"));
    if (!usersSnap.exists()) {
      sendMessage(chatId, "❌ No users found in database.");
      pendingActions.delete(userId);
      return;
    }

    const allUsers = usersSnap.val();
    const demoUsers = Object.values(allUsers)
      .filter((u) => typeof u.telegramId === "string" && u.telegramId.startsWith("demo"))
      .slice(0, demoCount);

    if (demoUsers.length === 0) {
      sendMessage(chatId, "⚠️ No demo users found.");
      pendingActions.delete(userId);
      return;
    }

    const updates = {};
    for (const demo of demoUsers) {
      const newBalance = (demo.balance || 0) + amount;
      updates[`users/${demo.telegramId}/balance`] = newBalance;
      updates[`users/${demo.telegramId}/updatedAt`] = new Date().toISOString();
    }

    await update(ref(rtdb), updates);
    sendMessage(chatId, `✅ Refilled ${amount} birr to ${demoUsers.length} demo accounts.`);
  } catch (err) {
    console.error("Error during demo refill:", err);
    sendMessage(chatId, "❌ Failed to refill demo accounts. Check logs for details.");
  }

  pendingActions.delete(userId);
  return;
}

// ====================== /RANDOM COMMAND ======================
// ====================== /RANDOM COMMAND ======================
if (text === "/random") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🎯 Enter the Room ID where random demo players will be added:");
  pendingActions.set(userId, { type: "awaiting_random_room" });
  return;
}


// Step 2: Get Room ID
if (pending?.type === "awaiting_random_room") {
  const roomId = text.trim();

  // ✅ Get room info
  const roomRef = ref(rtdb, `rooms/${roomId}`);
  const roomSnap = await get(roomRef);

  if (!roomSnap.exists()) {
    sendMessage(chatId, "❌ Room not found. Please enter a valid Room ID:");
    return;
  }

  const room = roomSnap.val();
  const betAmount = room.betAmount || 0;

  // ✅ Get current players
  const playersSnap = await get(ref(rtdb, `rooms/${roomId}/players`));
  const currentPlayers = playersSnap.exists() ? playersSnap.val() : {};

  // ✅ Get all users to filter demo players
  const usersSnap = await get(ref(rtdb, "users"));
  const allUsers = usersSnap.exists() ? usersSnap.val() : {};

  const eligibleDemoPlayers = Object.values(allUsers).filter(u =>
    typeof u.telegramId === "string" &&
    u.telegramId.startsWith("demo") &&
    (u.balance || 0) >= betAmount
  );

  sendMessage(
    chatId,
    `🔢 Room ${roomId} info: There are ${eligibleDemoPlayers.length} demo players with balance >= ${betAmount}.\n` +
    `Please enter how many new demo players to add:`
  );

  pendingActions.set(userId, { type: "awaiting_random_count", roomId });
  return;
}


// Step 3: Get quantity
if (pending?.type === "awaiting_random_count") {
  const count = parseInt(text.trim());
  if (isNaN(count) || count <= 0) {
    sendMessage(chatId, "❌ Invalid number. Please enter a positive number.");
    return;
  }

  sendMessage(chatId, "⚙️ Should the players be auto? (true / false):");
  pendingActions.set(userId, { 
    type: "awaiting_random_auto", 
    roomId: pending.roomId, 
    count 
  });
  return;
}

// Step 4: Get auto option and add players
// Step 4: Get auto option and add players
if (pending?.type === "awaiting_random_auto") {
  const auto = text.trim().toLowerCase() === "true";
  const { roomId, count } = pending;

  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
      sendMessage(chatId, "❌ Room not found.");
      pendingActions.delete(userId);
      return;
    }

    const room = roomSnap.val();

    // ✅ Check game status
    if (room.gameStatus && room.gameStatus.toLowerCase() === "playing") {
      sendMessage(chatId, "⚠️ You cannot add players while the game is currently playing.");
      pendingActions.delete(userId);
      return;
    }

    const betAmount = room.betAmount || 0;

    // ✅ Get bingo cards
    const cardsSnap = await get(ref(rtdb, `rooms/${roomId}/bingoCards`));
    if (!cardsSnap.exists()) {
      sendMessage(chatId, "⚠️ No bingo cards found for this room.");
      pendingActions.delete(userId);
      return;
    }
    const cards = cardsSnap.val();

    // ✅ Get current players
    const playersSnap = await get(ref(rtdb, `rooms/${roomId}/players`));
    const currentPlayers = playersSnap.exists() ? playersSnap.val() : {};

    // ✅ Find existing demo players already in this room
    const existingDemoPlayers = Object.values(currentPlayers).filter(p =>
      typeof p.telegramId === "string" && p.telegramId.startsWith("demo")
    );

    const existingDemoCount = existingDemoPlayers.length;
    const neededCount = Math.max(0, count - existingDemoCount);

    if (neededCount === 0) {
      sendMessage(chatId, `✅ There are already ${existingDemoCount} demo players. No new players needed.`);
      pendingActions.delete(userId);
      return;
    }

    // ✅ Filter unclaimed cards (one card per new user)
    const unclaimedCards = Object.entries(cards).filter(([_, c]) => !c.claimed);
    if (unclaimedCards.length < neededCount) {
      sendMessage(chatId, `⚠️ Not enough unclaimed cards (${unclaimedCards.length} available).`);
      pendingActions.delete(userId);
      return;
    }
    const shuffledCards = unclaimedCards.sort(() => 0.5 - Math.random());

    // ✅ Get all users and filter available demo users (not already in the room)
    const usersSnap = await get(ref(rtdb, "users"));
    if (!usersSnap.exists()) {
      sendMessage(chatId, "❌ No users found in the database.");
      pendingActions.delete(userId);
      return;
    }

    const allUsers = usersSnap.val();
    const demoUsers = Object.values(allUsers).filter(
      u =>
        typeof u.telegramId === "string" &&
        u.telegramId.startsWith("demo") &&
        !currentPlayers[u.telegramId] && // not already in the room
        (u.balance || 0) >= betAmount
    );

    if (demoUsers.length < neededCount) {
      sendMessage(
        chatId,
        `⚠️ Not enough available demo users with sufficient balance. (${demoUsers.length}/${neededCount})`
      );
      pendingActions.delete(userId);
      return;
    }

    // ✅ Randomly select needed demo users
    const selectedUsers = demoUsers.sort(() => 0.5 - Math.random()).slice(0, neededCount);

    // ✅ Generate unique usernames (not repeating)
    const availableNames = [
      "Abiti213", "Bubu_24", "temesgen2507", "bk52_2000", "blackii",
      "ዘላለም", "kala11", "አንዱ00", "Teda_xx1", "Abeni_20",
      "nattii1122", "Jonas_row", "Shmew_GG", "Abebe_123", "Sultan_great",
      "Rene_41", "mativiva", "Debeli_2023", "ሲሳይ_23", "Dereyew49", "Nahomx", "Biruk_101", "Miki_theOne", "KalebKing", "Eyobzz",
      "Nati_real", "YoniLover", "Beki45", "KiduPro", "Solo_999",
      "HenokD", "Teddy21", "Luelx", "DawitZone", "AbelPrime",
      "Getu44", "KaluMan", "Yafet07", "EyasCool", "Miki03",
      "Tesfu88", "Sami47", "Kida_777", "Dagi2025", "TekluW",
      "EyuXx", "Isra_boy", "Girmz22", "Teshi14", "BiruBoss",
      "MikiPro", "NahomFire", "Jonny_Eth", "Hailex", "Meru12",
      "BekiZero", "YonasXD", "Kal_2025", "SoloETH", "Kidus10"
    ];

    const usedUsernames = new Set(Object.values(currentPlayers).map(p => p.username));
    const uniqueNames = availableNames
      .filter(name => !usedUsernames.has(name))
      .sort(() => 0.5 - Math.random())
      .slice(0, neededCount);

    const now = Date.now();
    const updates = {};

    // ✅ Add new demo players and assign cards
    for (let i = 0; i < selectedUsers.length; i++) {
      const user = selectedUsers[i];
      const username = uniqueNames[i];
      const [cardId] = shuffledCards[i];

      updates[`rooms/${roomId}/players/${user.telegramId}`] = {
        attemptedBingo: false,
        betAmount,
        cardId,
        telegramId: user.telegramId,
        username,
      };

      updates[`rooms/${roomId}/bingoCards/${cardId}/claimed`] = true;
      updates[`rooms/${roomId}/bingoCards/${cardId}/claimedBy`] = user.telegramId;

      if (auto) {
        updates[`rooms/${roomId}/bingoCards/${cardId}/auto`] = true;
        updates[`rooms/${roomId}/bingoCards/${cardId}/autoUntil`] = now + 24 * 60 * 60 * 1000;
      }
    }

    await update(ref(rtdb), updates);

    // ✅ Balance redistribution among demo users
    const rich = Object.entries(allUsers)
      .filter(([_, u]) => u.telegramId?.startsWith("demo") && (u.balance || 0) > 50)
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => b.balance - a.balance);

    const poor = Object.entries(allUsers)
      .filter(([_, u]) => u.telegramId?.startsWith("demo") && (u.balance || 0) < 10)
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => a.balance - b.balance);

    const balanceUpdates = {};
    for (const donor of rich) {
      if (poor.length === 0) break;
      let donorBalance = donor.balance;

      while (donorBalance > 100 && poor.length > 0) {
        const receiver = poor[0];
        const needed = 100 - (receiver.balance || 0);
        const amountToGive = Math.min(needed, donorBalance - 100);

        receiver.balance += amountToGive;
        donorBalance -= amountToGive;

        balanceUpdates[`users/${receiver.id}/balance`] = receiver.balance;
        balanceUpdates[`users/${donor.id}/balance`] = donorBalance;

        if (receiver.balance >= 100) poor.shift();
      }
    }

    if (Object.keys(balanceUpdates).length > 0) {
      await update(ref(rtdb), balanceUpdates);
      console.log("💰 Redistributed balances among demo users.");
    }

    sendMessage(
      chatId,
      `✅ Added ${neededCount} new demo players (auto: ${auto}) to room ${roomId}.\n` +
      `💰 Demo balances rebalanced successfully.`
    );
  } catch (err) {
    console.error("Error adding random players:", err);
    sendMessage(chatId, "❌ Failed to add random players. Check logs for details.");
  }

  pendingActions.delete(userId);
  return;
}

if (text === "/demo") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  try {
    const usersSnap = await get(ref(rtdb, "users"));
    if (!usersSnap.exists()) {
      sendMessage(chatId, "❌ No users found in the database.");
      return;
    }

    const allUsers = usersSnap.val();
    const totalUsers = Object.keys(allUsers).length;

    // Debug: Show all telegramId formats
    const allTelegramIds = Object.values(allUsers).map(u => u.telegramId).filter(Boolean);
    const uniquePrefixes = [...new Set(allTelegramIds.map(id => id.substring(0, 4)))];
    
    // Case-insensitive demo filter
    const demoPlayers = Object.values(allUsers).filter(u =>
      typeof u.telegramId === "string" && u.telegramId.toLowerCase().startsWith("demo")
    );

    const totalBalance = demoPlayers.reduce((sum, u) => sum + (u.balance || 0), 0);
    const countAbove10 = demoPlayers.filter(u => (u.balance || 0) > 10).length;

    // Show first few demo players for debugging
    const sampleDemoPlayers = demoPlayers.slice(0, 5).map(p => ({
      id: p.telegramId,
      balance: p.balance
    }));

    sendMessage(
      chatId,
      `📊 Demo players info:\n` +
      `- Total users in DB: ${totalUsers}\n` +
      `- Total demo players: ${demoPlayers.length}\n` +
      `- Total balance: ${totalBalance}\n` +
      `- Players with balance > 10: ${countAbove10}\n` +
      `- Sample demo players: ${JSON.stringify(sampleDemoPlayers)}\n` +
      `- Unique prefixes found: ${uniquePrefixes.join(", ")}`
    );

  } catch (err) {
    console.error("Error fetching demo players:", err);
    sendMessage(chatId, "❌ Failed to fetch demo players. Check logs for details.");
  }

  return;
}
if (text.startsWith("/demoadd")) {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) {
    sendMessage(chatId, "❌ Usage: /demoadd <targetTelegramId>");
    return;
  }

  const targetTelegramId = parts[1].toLowerCase();

  try {
    const usersRef = ref(rtdb, "users");

    // 1️⃣ Read all users once
    const snapshot = await get(usersRef);
    const currentUsers = snapshot.val();

    if (!currentUsers) {
      sendMessage(chatId, "⚠️ No users found in database.");
      return;
    }

    // 2️⃣ Filter demo users
    const demoPlayers = Object.entries(currentUsers)
      .filter(([_, u]) => typeof u?.telegramId === "string" && u.telegramId.toLowerCase().startsWith("demo"));

    console.log("🧾 Demo players:", demoPlayers.map(([_, u]) => ({ id: u.telegramId, bal: u.balance })));

    const targetEntry = demoPlayers.find(([_, u]) => u.telegramId.toLowerCase() === targetTelegramId);
    if (!targetEntry) {
      sendMessage(chatId, "❌ Target demo player not found.");
      return;
    }

    const [targetKey, targetUser] = targetEntry;
    let totalRedistribute = 0;
    let anyDonor = false;

    // 3️⃣ Collect balances from other demo users
    for (const [key, u] of demoPlayers) {
      if (key === targetKey) continue;
      const bal = Number(u.balance) || 0;
      if (bal > 0) {  // <- changed from <10 to >0
        console.log(`→ Draining ${u.telegramId}: ${bal}`);
        totalRedistribute += bal;
        currentUsers[key].balance = 0;
        anyDonor = true;
      }
    }

    if (!anyDonor) {
      sendMessage(chatId, "⚠️ No eligible demo users to collect from. Nothing changed.");
      return;
    }

    // 4️⃣ Update target balance
    currentUsers[targetKey].balance = (Number(currentUsers[targetKey].balance) || 0) + totalRedistribute;

    await set(usersRef, currentUsers);

    console.log(`✅ Added ${totalRedistribute} to ${targetUser.telegramId}`);
    sendMessage(chatId, `✅ Balances collected and transferred to ${targetTelegramId}.`);
  } catch (err) {
    console.error("Error in /demoadd:", err);
    sendMessage(chatId, "❌ Failed to execute /demoadd. Check logs for details.");
  }

  return;
}





// Step 1: User types /reset
if (text === "/remove") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🔁 Please enter the Room ID to reset:");
  pendingActions.set(userId, { type: "awaiting_room_remove" });
  return;
}
if (text === "/removedemo") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "♻️ Resetting balance for all demo users...");

  try {
    const usersRef = ref(rtdb, "users");
    const usersSnap = await get(usersRef);

    if (!usersSnap.exists()) {
      sendMessage(chatId, "⚠️ No users found in database.");
      return;
    }

    const users = usersSnap.val();

    // Filter all demo users
    const demoUserIds = Object.entries(users)
      .filter(([_, u]) => u.telegramId?.startsWith("demo"))
      .map(([id]) => id);

    // Reset their balances
    for (const id of demoUserIds) {
      await update(ref(rtdb, `users/${id}`), { balance: 0 });
    }

    sendMessage(chatId, `✅ Reset balance for ${demoUserIds.length} demo users.`);
  } catch (err) {
    console.error("❌ Error resetting demo balances:", err);
    sendMessage(chatId, "❌ An error occurred while resetting demo balances.");
  }
}

// Step 2: Handle the room ID input after /reset
if (pendingActions.has(userId)) {
  const action = pendingActions.get(userId);

  if (action.type === "awaiting_room_remove") {
    const roomId = text.trim(); // text is the room ID entered by the admin

    try {
      const roomRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
      const snap = await get(roomRef);

      if (!snap.exists()) {
        sendMessage(chatId, `⚠️ No cards found for room ${roomId}`);
        pendingActions.delete(userId);
        return;
      }

      const cards = snap.val();
      const updates = {};

      for (const [cardId, card] of Object.entries(cards)) {
        updates[`rooms/${roomId}/bingoCards/${cardId}/claimed`] = false;
        updates[`rooms/${roomId}/bingoCards/${cardId}/auto`] = false;
        updates[`rooms/${roomId}/bingoCards/${cardId}/autoUntil`] = null;
        updates[`rooms/${roomId}/bingoCards/${cardId}/claimedBy`] = null;
      }

      await update(ref(rtdb), updates);

      sendMessage(chatId, `✅ All cards in room ${roomId} have been reset (unclaimed).`);
      console.log(`🧹 Admin ${userId} unclaimed all cards in ${roomId}`);
    } catch (err) {
      console.error("❌ Error resetting cards:", err);
      sendMessage(chatId, "⚠️ Error while unclaiming cards.");
    }

    pendingActions.delete(userId); // clear the pending action
  }
}


// ====================== /RESET COMMAND ======================
if (text === "/reset") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🔁 Please enter the Room ID to reset:");
  pendingActions.set(userId, { type: "awaiting_room_reset" });
  return;
}

// Step 2: Handle room ID input
if (pending?.type === "awaiting_room_reset") {
  const roomId = text.trim();
  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
      sendMessage(chatId, `❌ Room with ID '${roomId}' not found.`);
      pendingActions.delete(userId);
      return;
    }

    const roomData = roomSnap.val();
    const previousState = roomData.gameStatus || "unknown";
    const betAmount = parseFloat(roomData.betAmount || 0);
    const players = Object.values(roomData.players || {});

    // If the room was playing, refund players
    if (previousState === "playing" && players.length > 0 && betAmount > 0) {
      for (const player of players) {
        if (!player.telegramId) continue;

        const userRef = ref(rtdb, `users/${player.telegramId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) continue;

        const userData = userSnap.val();
        const newBalance = (userData.balance || 0) + betAmount;
        await update(userRef, { balance: newBalance });
      }
      sendMessage(chatId, `✅ Room '${roomId}' was in playing state — refunded ${betAmount} birr to each player.`);
    }

    // Change room state to "waiting"
    await update(roomRef, { gameStatus: "waiting" });
    sendMessage(chatId, `♻️ Room '${roomId}' has been reset to 'waiting' state.`);

  } catch (err) {
    console.error("❌ Error resetting room:", err);
    sendMessage(chatId, "❌ Failed to reset room. Check logs for details.");
  }

  pendingActions.delete(userId);
  return;
}
if (text === "/stop") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🔁 Please enter the Room ID to reset:");
  pendingActions.set(userId, { type: "awaiting_room_restart" });
  return;
}

// Step 2: Handle room ID input
if (pending?.type === "awaiting_room_restart") {
  const roomId = text.trim();
  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
      sendMessage(chatId, `❌ Room with ID '${roomId}' not found.`);
      pendingActions.delete(userId);
      return;
    }

    const roomData = roomSnap.val();
    const previousState = roomData.gameStatus || "unknown";
    const betAmount = parseFloat(roomData.betAmount || 0);
    const players = Object.values(roomData.players || {});

    // If the room was playing, refund players
    if (previousState === "playing" && players.length > 0 && betAmount > 0) {
      for (const player of players) {
        if (!player.telegramId) continue;

        const userRef = ref(rtdb, `users/${player.telegramId}`);
        const userSnap = await get(userRef);
        if (!userSnap.exists()) continue;

        const userData = userSnap.val();
        const newBalance = (userData.balance || 0) + betAmount;
        await update(userRef, { balance: newBalance });
      }
      sendMessage(chatId, `✅ Room '${roomId}' was in playing state — refunded ${betAmount} birr to each player.`);
    }

    // Change room state to "waiting"
    await update(roomRef, { gameStatus: "stopped" });
    sendMessage(chatId, `♻️ Room '${roomId}' has been reset to 'waiting' state.`);

  } catch (err) {
    console.error("❌ Error resetting room:", err);
    sendMessage(chatId, "❌ Failed to reset room. Check logs for details.");
  }

  pendingActions.delete(userId);
  return;
}
// 🧩 /stopdemo Command
if (text === "/stopdemo") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  sendMessage(chatId, "🛑 Enter the Room ID where demo players should be removed:");
  pendingActions.set(userId, { type: "awaiting_stopdemo_room" });
  return;
}

// Step 2: Handle room ID input
if (pending?.type === "awaiting_stopdemo_room") {
  const roomId = text.trim();

  try {
    const roomRef = ref(rtdb, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
      sendMessage(chatId, "❌ Room not found.");
      pendingActions.delete(userId);
      return;
    }

    const room = roomSnap.val();

    // ✅ Ensure room is not currently playing
    if (room.gameStatus && room.gameStatus.toLowerCase() === "playing") {
      sendMessage(chatId, "⚠️ You cannot remove demo players while the game is playing.");
      pendingActions.delete(userId);
      return;
    }

    const playersSnap = await get(ref(rtdb, `rooms/${roomId}/players`));
    if (!playersSnap.exists()) {
      sendMessage(chatId, "⚠️ No players found in this room.");
      pendingActions.delete(userId);
      return;
    }

    const players = playersSnap.val();
    const cardsSnap = await get(ref(rtdb, `rooms/${roomId}/bingoCards`));
    const cards = cardsSnap.exists() ? cardsSnap.val() : {};

    const updates = {};
    let removedCount = 0;

    for (const [telegramId, player] of Object.entries(players)) {
      if (telegramId.startsWith("demo")) {
        removedCount++;

        // Unclaim their card
        if (player.cardId && cards[player.cardId]) {
          updates[`rooms/${roomId}/bingoCards/${player.cardId}/claimed`] = false;
          updates[`rooms/${roomId}/bingoCards/${player.cardId}/claimedBy`] = null;
          updates[`rooms/${roomId}/bingoCards/${player.cardId}/auto`] = null;
          updates[`rooms/${roomId}/bingoCards/${player.cardId}/autoUntil`] = null;
        }

        // Remove demo player
        updates[`rooms/${roomId}/players/${telegramId}`] = null;
      }
    }

    if (removedCount > 0) {
      await update(ref(rtdb), updates);
      sendMessage(chatId, `✅ Removed ${removedCount} demo players from room ${roomId}.`);
    } else {
      sendMessage(chatId, `ℹ️ No demo players found in room ${roomId}.`);
    }
  } catch (err) {
    console.error("❌ Error while removing demo players:", err);
    sendMessage(chatId, "❌ Failed to remove demo players. Check logs for details.");
  }

  pendingActions.delete(userId);
  return;
}

if (text === "/transaction") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  try {
    // Fetch transaction data
    const response = await fetch(
      (process.env.WEBAPP_URL || "https://fridaybot-9jrb.onrender.com") + "/api/transaction"
    );
    if (!response.ok) throw new Error("Failed to fetch transaction data");

    const data = await response.json();

    const todayDate = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const isWithinWeek = (dateStr) => new Date(dateStr) >= weekAgo;

    // Helper function to calculate summary for a period
    const calculateSummary = (period) => {
      let deposits = 0, withdrawals = 0, revenueDrawned = 0, revenueUndrawned = 0;

      if (period === "today") {
        deposits = data.deposits.depositsByDate[todayDate] || 0;
        withdrawals = data.withdrawals.withdrawalsByDate[todayDate] || 0;
        revenueDrawned = data.revenue.drawnedByDate[todayDate] || 0;
        revenueUndrawned = data.revenue.undrawnedByDate[todayDate] || 0;
      } else if (period === "week") {
        for (const date in data.deposits.depositsByDate) if (isWithinWeek(date)) deposits += data.deposits.depositsByDate[date];
        for (const date in data.withdrawals.withdrawalsByDate) if (isWithinWeek(date)) withdrawals += data.withdrawals.withdrawalsByDate[date];
        for (const date in data.revenue.drawnedByDate) if (isWithinWeek(date)) revenueDrawned += data.revenue.drawnedByDate[date] || 0;
        for (const date in data.revenue.undrawnedByDate) if (isWithinWeek(date)) revenueUndrawned += data.revenue.undrawnedByDate[date] || 0;
      } else if (period === "whole") {
        deposits = data.deposits.totalDeposits;
        withdrawals = data.withdrawals.totalWithdrawals;
        revenueDrawned = data.revenue.totalDrawned;
        revenueUndrawned = data.revenue.totalUndrawned;
      }

      return { deposits, withdrawals, revenueDrawned, revenueUndrawned };
    };

    // Generate summaries
    const today = calculateSummary("today");
    const week = calculateSummary("week");
    const whole = calculateSummary("whole");

    // Build final message
    let summary = `📊 Transaction Summary\n\n`;
    summary += `👥 Total Balance: ${data.balances.totalBalance}\n\n`;

    summary += `📅 Today:\n`;
    summary += `🏦 Deposits: ${today.deposits}\n`;
    summary += `💸 Withdrawals: ${today.withdrawals}\n`;
    summary += `💰 Revenue (Drawned): ${today.revenueDrawned}\n`;
    summary += `💰 Revenue (Undrawned): ${today.revenueUndrawned}\n\n`;

    summary += `📆 This Week:\n`;
    summary += `🏦 Deposits: ${week.deposits}\n`;
    summary += `💸 Withdrawals: ${week.withdrawals}\n`;
    summary += `💰 Revenue (Drawned): ${week.revenueDrawned}\n`;
    summary += `💰 Revenue (Undrawned): ${week.revenueUndrawned}\n\n`;

    summary += `🌍 Whole Period:\n`;
    summary += `🏦 Deposits: ${whole.deposits}\n`;
    summary += `💸 Withdrawals: ${whole.withdrawals}\n`;
    summary += `💰 Revenue (Drawned): ${whole.revenueDrawned}\n`;
    summary += `💰 Revenue (Undrawned): ${whole.revenueUndrawned}\n`;

    sendMessage(chatId, summary);
  } catch (err) {
    console.error("Error fetching /transaction:", err);
    sendMessage(chatId, "❌ Failed to fetch transaction data.");
  }
}

  // ====================== FALLBACK ======================
  sendMessage(chatId, t(lang, "fallback"));
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
    sendMessage(chatId, t(lang, "welcome"));
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

  sendMessage(chatId, infoText, { parse_mode: "MarkdownV2" });
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
      sendMessage(req.userId, t(lang, "approved_deposit", req.amount));
      // Notify admin
      sendMessage(chatId, t(lang, "admin_approved_deposit", `@${user.username || req.userId}`, req.amount));
    }
    depositRequests.delete(requestId);
    return;
  }

  if (data.startsWith("decline_deposit_")) {
    const requestId = data.replace("decline_deposit_", "");
    const req = depositRequests.get(requestId);
    if (!req) return;

    sendMessage(req.userId, t(lang, "declined_deposit"));
    sendMessage(chatId, t(lang, "admin_declined_deposit", `@${req.userId}`, req.amount));
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
      sendMessage(chatId, t(lang, "enter_cbe"));
    } else {
      sendMessage(chatId, t(lang, "enter_telebirr"));
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
      sendMessage(req.userId, t(lang, "approved_withdraw", req.amount, req.account));
      sendMessage(chatId, t(lang, "admin_approved_withdraw", `@${user.username || req.userId}`, req.amount));
    }
    withdrawalRequests.delete(requestId);
    return;
  }

  if (data.startsWith("decline_withdraw_")) {
    const requestId = data.replace("decline_withdraw_", "");
    const req = withdrawalRequests.get(requestId);
    if (!req) return;

    sendMessage(req.userId, t(lang, "declined_withdraw"));
    sendMessage(chatId, t(lang, "admin_declined_withdraw", `@${req.userId}`, req.amount));
    withdrawalRequests.delete(requestId);
    return;
  }

  telegram("answerCallbackQuery", { callback_query_id: callbackQuery.id });
}

 // check every 1 minute


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
