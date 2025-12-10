import { ref, get, set, update, push , remove, runTransaction } from "firebase/database";
import { rtdb } from "../bot/firebaseConfig.js"; 
import fetch from "node-fetch";
import { gameManager } from "./game-manager.js";
import redis from "./redisClient.js";
import {getApiUrl} from "./api.js";
const ADMIN_PASSCODE = "19991999"; // Ideally move to process.env.ADMIN_PASSCODE

// Helper function to get webapp URL (defaults to localhost for development)
function getWebappUrl() {
  return process.env.WEBAPP_URL || 
      (process.env.NODE_ENV === 'production' 
        ? "https://fridaybot-c47n.onrender.com"
      : `http://localhost:${process.env.PORT || 5000}`);
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
om: {
  welcome:
"🎯 Baga nagaan dhufte Friday Bingo!\nGaaffii yoo qabaattan @Natii4545\n\nAjajawwan:\n/playgame - Tapha eegalu\n/deposit - Maallaqa dabaluu\n/withdraw - Galii baasuu",

  choose_lang: "🌍 Afaan filadhu:",
  receipt_used :"Lakkoofsi kana duraan fayyadame!",
  play: "🎉 Tapha Bingo haa eegallu!",
  enter_deposit_amount : "Maallaqa itti dabaluu barbaaddu galchi:",
  deposit_method: "Karaa kaffaltii filadhu:",
  deposit_amount: (method) => `Maallaqa ${method} ittiin dabaluu barbaaddu galchi:`,
  deposit_sms: (method) => `📩 Mee ergaa ${method} ergame nuuf ergaa.`,
  withdraw_amount: "💵 Maallaqa baasuu barbaaddu galchi:",
  select_withdraw_method : "Karaa baasuu filadhu:",
  withdraw_method: "Karaa baasuu filadhu:",
  withdraw_cbe: "🏦 Lakk. herrega CBE galchi:",
  withdraw_telebirr: "📱 Lakk. Telebirr galchi:",
  invalid_amount: "❌ Maallaqa sirrii galchi.",
  insufficient_balance: "❌ Maallaqa sirrii hin qabdu.",
  enter_cbe :"Lakk. Herrega CBE galchi:",
  enter_telebirr : "Lakk. Telebirr galchi:",
  no_link: "❌ Link hin argamne. Mee irra deebi'ii ergaa.",
  link_used: "⚠️ Ergaan/link kun duraan fayyadame.",
  wait_admin: "⏳ Itti aanee eeggadhu, admin ni ilaala.",
  approved_deposit: (amt) => `✅ Dabalataan sirriitti galmaa'e!\n+${amt} birri siif dabalame.`,
  declined_deposit: "❌ Dabalataan ni haquame.",
  approved_withdraw: (amt, acc) => `✅ Maallaqa baasuu milkaa'e!\n-${amt} birri gara ${acc} tti ergame.`,
  declined_withdraw: "❌ Gaafatiin siif hin eeyyamamne.",
  fallback: "Taphachuuf /playgame ykn /deposit ykn /withdraw fayyadami.",
  withdraw_pending :"Eeggachaa jira…",
  admin_declined_withdraw : "❌ Admin hin eeyyamne!",
  admin_approved_withdraw :  "✅ Admin eeyyame!",
  admin_approved_deposit:  "✅ Admin eeyyame!",
  admin_declined_deposit : "❌ Admin hin eeyyamne!",
  star_bingo:"Bingo eegaluu",
  withdraw : "Maallaqa baasuu",
  deposit : "Maallaqa dabaluu",
  help : "Gargaarsa",
  help_text: `
🎮 *Bingo akkamitti taphatan*

1️⃣ /deposit fayyadamuun maallaqa galchaa  
2️⃣ /playgame fayyadamuun gara taphatti seenaa  
3️⃣ Taphattoonni guutuu eeggadhaa  
4️⃣ Lakkoofsi ofumaan ni baha  
5️⃣ Lakkoofsa card keessan irratti argamtuu cuqaasaa  
6️⃣ Fakkii mo’ichaa guuttanii moo’attu  
7️⃣ /withdraw fayyadamuun baasuu dandeessu  

Baga taphattan 🎉`,
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
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5-second timeout

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      console.warn(`⚠️ Telegram API error: ${res.status} - ${text}`);
      return { ok: false, error: text };
    }

    return await res.json();
  } catch (err) {
    console.error(`❌ Telegram send error:`, err.message);
    return { ok: false, error: err.message }; // Never throw!
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


// ====================== MESSAGE HELPERS ======================
function extractUrlFromText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  return match ? match[0] : null;
}

// ====================== HANDLERS ======================
async function handleStart(message) {
  const chatId = message.chat.id;
  const userId = message.from.id;

  // Skip demo users
  if (String(userId).startsWith("demo")) {
    sendMessage(chatId, "Demo players are not required to register.");
    return;
  }

  // Check if already registered
  const userRef = ref(rtdb, `users/${userId}`);
  const snap = await get(userRef);
  if (!snap.exists()) {
    // Ask user to share phone number
    const keyboard = {
      keyboard: [
        [
          {
            text: "📱 Share Phone Number",
            request_contact: true,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };

    await sendMessage(chatId, "📞 Please share your phone number to complete registration:", {
      reply_markup: keyboard,
    });
  } else {
    // Already registered → go to language selection
    const keyboard = {
      inline_keyboard: [
        [{ text: "English 🇬🇧", callback_data: "lang_en" }],
        [{ text: "አማርኛ 🇪🇹", callback_data: "lang_am" }],
        [{ text: "Afaan Oromoo 🇪🇹", callback_data: "lang_om" }],
      ],
    };
    
    sendMessage(chatId, t("en", "choose_lang"), { reply_markup: keyboard });
  }
}


import crypto from "crypto";
const API = `https://api.telegram.org/bot${TOKEN}`;
const commands = [
  { command: "playgame", description: t("am", "start_bingo") },
  { command: "deposit", description:  t("am", "deposit") },
  { command: "withdraw", description:  t("am", "withdraw") },
  { command: "help", description: t("am", "help") },
];

// Register the commands with Telegram (only once, not every time)
async function setCommands() {
  try {
    const response = await fetch(`${API}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });

    const data = await response.json();
    console.log("Set Commands Response:", data);
  } catch (err) {
    console.error("⚠️ Failed to set Telegram commands:", err);
  }
}

// ✅ Run once during startup (not on every game or user event)
if (process.env.NODE_ENV !== "production") {
  setCommands();
}

async function handlePlaygame(message) {
  const chatId = message.chat.id;
  const telegramId = String(message.from.id);

  // Ignore demo users
  if (telegramId.startsWith("demo")) {
    sendMessage(chatId, "🧪 Demo players can’t open the web app.");
    return;
  }

  const userRef = ref(rtdb, `users/${telegramId}`);
  const userSnap = await get(userRef);

  // ✅ If user does not exist OR has no phoneNumber → ask for phone number
  if (!userSnap.exists() || !userSnap.val().phoneNumber) {
    const keyboard = {
      keyboard: [
        [
          {
            text: "📱 Share Phone Number",
            request_contact: true,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };

    await sendMessage(
      chatId,
      "📞 Please share your phone number to complete registration before playing:",
      { reply_markup: keyboard }
    );

    return; // stop here — don’t open webapp
  }

  // ✅ If phone number exists, continue to web app
  const secret = process.env.TELEGRAM_BOT_TOKEN;
  const sig = crypto.createHmac("sha256", secret).update(telegramId).digest("hex");
  
  const baseUrl = getWebappUrl();
  const webAppUrl = `${baseUrl}?id=${telegramId}&sig=${sig}`;

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
async function handleReferral(message) {
  const chatId = message.chat.id;
  const userId = String(message.from.id);

  const userRef = ref(rtdb, `users/${userId}`);
  const userSnap = await get(userRef);

  // If user not registered
  if (!userSnap.exists()) {
    return sendMessage(chatId, "❗ You must register first. Send /start");
  }

  let user = userSnap.val();

  // If user already has a referral code → return same code
  if (user.referralCode) {
    return sendMessage(chatId, `🎉 Your referral code is:\n\n🔗 *${user.referralCode}*`, { parse_mode:"Markdown" });
  }

  // Generate a unique 6 character code
  const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

  // store referral under referral node
  const referralRef = ref(rtdb, `referrals/${referralCode}`);
  await set(referralRef, {
    userId,
    createdAt: new Date().toISOString()
  });

  sendMessage(chatId,
    `🎉 Referral code generated!\n\n` +
    `🔗 Your referral code is:\n*${referralCode}*\n\n` +
    `Share this code with friends!`,
    { parse_mode:"Markdown" }
  );
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
  if (message.contact) {
    const contact = message.contact;
    const chatId = message.chat.id;
  
    // Ignore demo players
    if (String(contact.user_id).startsWith("demo")) return;
  
    const userRef = ref(rtdb, `users/${contact.user_id}`);
    const snap = await get(userRef);
  
    const now = new Date().toISOString();
    const newUser = {
      telegramId: contact.user_id.toString(),
      username: message.from.username || message.from.first_name || `user_${contact.user_id}`,
      phoneNumber: contact.phone_number,
      noreferral : true,
      balance: 10,
      gamesPlayed: 0,
      gamesWon: 0,
      totalWinnings: 0,
      lang: "en",
      createdAt: now,
      updatedAt: now,
    };
  
    await set(userRef, newUser);
  
    // Proceed to language choice
    const keyboard = {
      inline_keyboard: [
        [{ text: "English 🇬🇧", callback_data: "lang_en" }],
        [{ text: "አማርኛ 🇪🇹", callback_data: "lang_am" }],
      ],
    };
  
    sendMessage(chatId, "✅ Thank you! Registration completed.\nNow choose your language:", {
      reply_markup: keyboard,
    });
    return;
  }
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
  if (text === "/referral") return handleReferral(message);


  

// Define your commands


  // ====================== DEPOSIT AMOUNT STEP ======================
  if (pending?.type === "awaiting_deposit_amount") {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      sendMessage(chatId, t(lang, "invalid_amount"));
      return;
    }
    if (amount < 50) {
      sendMessage(chatId, "⚠️ Minimum deposit is 50 birr.");
      pendingActions.delete(userId);
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
    const response = await fetch(`${getWebappUrl()}/api/player`, {
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
    const response = await fetch(`${getWebappUrl()}/api/revenue`);
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
    const response = await fetch(`${getWebappUrl()}/api/revenue`);
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


if (pending?.type === "awaiting_random_room") {
  const roomId = text.trim();

  const res = await fetch(getApiUrl(`/api/room-state?roomId=${roomId}`));
  const data = await res.json();

  if (!res.ok || !data.room) {
    return sendMessage(chatId, "❌ Room not found. Try again:");
  }

  const room = data.room;
  const betAmount = room.betAmount || 0;

  // extract bingo cards
  const cards = data.room.bingoCards || {};
  const unclaimedCards = Object.entries(cards).filter(([_, c]) => !c.claimed);

  if (unclaimedCards.length === 0) {
    return sendMessage(chatId,"⚠️ No unclaimed cards in this room.");
  }

  sendMessage(
    chatId,
    `🎯 Room ${roomId} found.\n`+
    `Available unclaimed cards: ${unclaimedCards.length}\n`+
    "Enter how many demo players to add:"
  );

  await pendingActions.set(userId,{ type:"awaiting_random_count", roomId });
  return;
}



// Step 3: Get quantity
if (pending?.type === "awaiting_random_count") {
  const count = Number(text.trim());

  if (!count || count <= 0) {
    return sendMessage(chatId,"❌ Invalid number. Enter a positive number.");
  }

  sendMessage(chatId,"⚙️ Auto mode for players? (true / false)");
  await pendingActions.set(userId,{ type:"awaiting_random_auto", roomId: pending.roomId, count });
  return;
}


if (pending?.type === "awaiting_random_auto") {
  const auto = text.trim().toLowerCase() === "true";
  const { roomId, count } = pending;

  try {
    // Fetch room state again to get fresh cards & players
    const state = await fetch(getApiUrl(`/api/room-state?roomId=${roomId}`)).then(r=>r.json());
    const room = state.room;
    if (!room) return sendMessage(chatId,"Room not found.");

    const cards = room.bingoCards || {};

    // Eligible unclaimed cards
    const unclaimedCards = Object.entries(cards)
      .filter(([id,card])=>!card.claimed)
      .sort(()=>Math.random()-0.5)
      .slice(0,count);

    if(unclaimedCards.length < count){
      return sendMessage(chatId,`⚠ Only ${unclaimedCards.length} free cards available.`);
    }

    // Fetch users for demo pick
    const usersSnap = await get(ref(rtdb,"users"));
    const users = usersSnap.val()||{};

    const demoUsers = Object.values(users)
      .filter(u=>u.telegramId?.startsWith("demo") && (u.balance||0)>=room.betAmount)
      .sort(()=>Math.random()-0.5)
      .slice(0,count);

    if(demoUsers.length < count){
      return sendMessage(chatId,`⚠ Only ${demoUsers.length} demo users available`);
    }

    for (let i=0;i<count;i++){
      const user = demoUsers[i];
      const [cardId] = unclaimedCards[i]; // assign a card

      // PLACE BET using YOUR API → stored in Redis automatically
      const result = await fetch(getApiUrl("/api/place-bet"),{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({
          roomId,
          cardId,
          userId:user.telegramId  // 👈 DEMO PLAYER BET LOGIC FIXED HERE
        })
      }).then(r=>r.json());

      if(!result.success){
        console.log("Bet failed:",user.telegramId, result.message);
        continue;
      }

      // AUTO MODE
      if(auto){
        await fetch(getApiUrl("/api/toggle-auto"),{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({ roomId, cardId, auto:true })
        });
      }
    }

    sendMessage(chatId,`🎉 Added ${count} demo players to room ${roomId}\nAUTO MODE: ${auto}`);

  } catch(err){
    console.error(err);
    sendMessage(chatId,"❌ Error adding demo players");
  }

  await pendingActions.delete(userId);
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

    // 3️⃣ Collect balances only from demo users whose balance is below 10
    for (const [key, u] of demoPlayers) {
      if (key === targetKey) continue;
      const bal = Number(u.balance) || 0;
      if (bal > 0 && bal < 10) {  // ✅ only drain balances below 10
        console.log(`→ Draining ${u.telegramId}: ${bal}`);
        totalRedistribute += bal;
        currentUsers[key].balance = 0;
        anyDonor = true;
      }
    }

    if (!anyDonor) {
      sendMessage(chatId, "⚠️ No eligible demo users (balance < 10) to collect from. Nothing changed.");
      return;
    }

    // 4️⃣ Update target balance
    currentUsers[targetKey].balance = (Number(currentUsers[targetKey].balance) || 0) + totalRedistribute;

    await set(usersRef, currentUsers);

    console.log(`✅ Added ${totalRedistribute} to ${targetUser.telegramId}`);
    sendMessage(chatId, `✅ Collected ${totalRedistribute} from demo users with <10 balance and added to ${targetTelegramId}.`);
  } catch (err) {
    console.error("Error in /demoadd:", err);
    sendMessage(chatId, "❌ Failed to execute /demoadd. Check logs for details.");
  }

  return;
}




// ====================== /CLEARDemo BALANCES ======================
if (text === "/cleardemo") {
  if (!ADMIN_IDS.includes(userId)) {
    return sendMessage(chatId, "❌ You are not authorized to use this command.");
  }

  sendMessage(
    chatId,
    "🧹 Clear demo balances:\n\n" +
    "Reply with `all` to set all demo users' balances to 0,\n" +
    "or reply with a single demo Telegram ID (e.g. `demo123`) to clear one user."
  );
  pendingActions.set(userId, { type: "awaiting_cleardemo_target" });
  return;
}

if (pending?.type === "awaiting_cleardemo_target") {
  const target = text.trim();

  try {
    const usersRef = ref(rtdb, "users");
    const snap = await get(usersRef);
    if (!snap.exists()) {
      sendMessage(chatId, "⚠️ No users found in database.");
      pendingActions.delete(userId);
      return;
    }

    const allUsers = snap.val();

    // Case 1: clear all demo balances
    if (target.toLowerCase() === "all") {
      const updates = {};
      let clearedCount = 0;

      for (const [key, u] of Object.entries(allUsers)) {
        // defensively handle telegramId stored as string on user object
        const tId = (u && u.telegramId) ? String(u.telegramId) : null;
        if (tId && tId.toLowerCase().startsWith("demo")) {
          updates[`users/${key}/balance`] = 0;
          updates[`users/${key}/updatedAt`] = new Date().toISOString();
          clearedCount++;
        }
      }

      if (clearedCount === 0) {
        sendMessage(chatId, "⚠️ No demo users found to clear.");
      } else {
        // apply all updates at once
        await update(ref(rtdb), updates);
        sendMessage(chatId, `✅ Cleared balances for ${clearedCount} demo users.`);
      }

      pendingActions.delete(userId);
      return;
    }

    // Case 2: clear single demo id
    // Accept either a direct key (user node key) or a telegramId that begins with 'demo'
    const searchId = target; // e.g. "demo123"

    // Try direct path first (users/<searchId>)
    const directRef = ref(rtdb, `users/${searchId}`);
    const directSnap = await get(directRef);

    if (directSnap.exists() && String(directSnap.val().telegramId).toLowerCase().startsWith("demo")) {
      await update(directRef, { balance: 0, updatedAt: new Date().toISOString() });
      sendMessage(chatId, `✅ Cleared balance for ${searchId}.`);
      pendingActions.delete(userId);
      return;
    }

    // Otherwise, search by telegramId field
    let foundKey = null;
    for (const [key, u] of Object.entries(allUsers)) {
      if (u && typeof u.telegramId === "string" && u.telegramId.toLowerCase() === searchId.toLowerCase()) {
        foundKey = key;
        break;
      }
    }

    if (!foundKey) {
      sendMessage(chatId, "❌ Demo user not found. Make sure you provided the correct demo id (e.g. demo123).");
      pendingActions.delete(userId);
      return;
    }

    await update(ref(rtdb, `users/${foundKey}`), { balance: 0, updatedAt: new Date().toISOString() });
    sendMessage(chatId, `✅ Cleared balance for ${searchId}.`);
    pendingActions.delete(userId);
    return;

  } catch (err) {
    console.error("Error during /cleardemo:", err);
    sendMessage(chatId, "❌ Failed to clear demo balances. Check server logs.");
    pendingActions.delete(userId);
    return;
  }
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


// Step 2: Handle the room ID input after /reset
if (pendingActions.has(userId)) {
  const action = pendingActions.get(userId);

  if (action.type === "awaiting_room_remove") {
    const roomId = text.trim(); // text is the room ID entered by the admin
  
    try {
      // --- Step 1️⃣: Unclaim all bingo cards ---
      const cardsRef = ref(rtdb, `rooms/${roomId}/bingoCards`);
      const cardsSnap = await get(cardsRef);
  
      const updates = {};
  
      if (cardsSnap.exists()) {
        const cards = cardsSnap.val();
  
        for (const [cardId] of Object.entries(cards)) {
          updates[`rooms/${roomId}/bingoCards/${cardId}/claimed`] = false;
          updates[`rooms/${roomId}/bingoCards/${cardId}/auto`] = false;
          updates[`rooms/${roomId}/bingoCards/${cardId}/autoUntil`] = null;
          updates[`rooms/${roomId}/bingoCards/${cardId}/claimedBy`] = null;
        }
  
        console.log(`🧩 Unclaiming ${Object.keys(cards).length} cards in room ${roomId}`);
      } else {
        console.log(`⚠️ No bingo cards found in room ${roomId}`);
      }
  
      // --- Step 2️⃣: Remove all players from the room ---
      const playersRef = ref(rtdb, `rooms/${roomId}/players`);
      const playersSnap = await get(playersRef);
  
      if (playersSnap.exists()) {
        const players = playersSnap.val();
        for (const playerId of Object.keys(players)) {
          updates[`rooms/${roomId}/players/${playerId}`] = null;
        }
  
        console.log(`👥 Removing ${Object.keys(players).length} players from room ${roomId}`);
      } else {
        console.log(`ℹ️ No players found in room ${roomId}`);
      }
  
      // --- Step 3️⃣: Apply all updates at once ---
      if (Object.keys(updates).length > 0) {
        await update(ref(rtdb), updates);
        sendMessage(chatId, `✅ Room ${roomId} has been fully reset — all cards unclaimed and all players removed.`);
        console.log(`🧹 Admin ${userId} fully reset room ${roomId}`);
      } else {
        sendMessage(chatId, `⚠️ Room ${roomId} already clean (no players or cards found).`);
      }
    } catch (err) {
      console.error("❌ Error resetting room:", err);
      sendMessage(chatId, "⚠️ Error while resetting room.");
    }
  
    pendingActions.delete(userId); // clear pending action
  }
  
}
// ====================== /REMOVEDEMO ======================
if (text === "/removedemo") {
  if (!ADMIN_IDS.includes(userId)) {
    return sendMessage(chatId, "❌ You are not authorized to use this command.");
  }

  sendMessage(chatId, "🏷 Enter the Room ID to remove demo players from:");
  await pendingActions.set(userId, { type: "awaiting_removedemo_room" });
  return;
}


// Step 2 — handle room input
if (pending?.type === "awaiting_removedemo_room") {
  const roomId = text.trim();

  try {
    // Fetch state from API instead of RTDB direct
    const state = await fetch(getApiUrl(`/api/room-state?roomId=${roomId}`)).then(r=>r.json());

    if (!state.room) {
      return sendMessage(chatId, "❌ Room not found. Enter a valid Room ID:");
    }

    const room = state.room;

    // check status
    const status = (room.gameStatus || room.roomStatus || "").toLowerCase();
    if (status === "playing") {
      return sendMessage(chatId,"⚠️ Game is currently playing.\nStop the room first before removing demo players.");
    }

    sendMessage(chatId, `♻ Confirm to remove all demo users & reset balances in room *${roomId}*?\n\nReply: **yes** to proceed`);
    await pendingActions.set(userId,{ type:"awaiting_removedemo_confirm", roomId });
    return;

  } catch (err) {
    console.error(err);
    return sendMessage(chatId,"❌ Failed to fetch room state.");
  }
}


// Step 3 — confirmation & processing
if (pending?.type === "awaiting_removedemo_confirm") {
  if (text.trim().toLowerCase() !== "yes") {
    await pendingActions.delete(userId);
    return sendMessage(chatId,"❌ Operation cancelled.");
  }

  const roomId = pending.roomId;

  sendMessage(chatId,"⏳ Removing demo players & clearing balances...");

  try {
    // Pull fresh room state
    const state = await fetch(getApiUrl(`/api/room-state?roomId=${roomId}`)).then(r=>r.json());
    const room = state.room;
    const cards = room.bingoCards || {};

    // find demo-owned cards
    const demoCards = Object.entries(cards)
      .filter(([_,c])=>String(c.claimedBy).startsWith("demo"));

    // cancel each card bet through Redis API
    for (const [cardId,card] of demoCards) {
      await fetch(getApiUrl("/api/cancel-bet"),{
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ roomId, cardId, userId: card.claimedBy })
      }).catch(()=>{});
    }

    // Reset demo balances globally using API not Firebase
    

    sendMessage(chatId,`✅ Removed ${demoCards.length} demo bets  in room ${roomId}.`);

  } catch(err) {
    console.error(err);
    sendMessage(chatId,"❌ Failed removing demo players.");
  }

  await pendingActions.delete(userId);
  return;
}


if (text === "/reset") {
  if (!ADMIN_IDS.includes(userId)) {
    return sendMessage(chatId,"❌ You are not authorized.");
  }

  sendMessage(chatId,"🌀 Enter Room ID to reset:");
  await pendingActions.set(userId,{ type:"awaiting_room_reset" });
  return;
}


// Step 2 — Handle Room ID
if (pending?.type === "awaiting_room_reset") {
  const roomId = text.trim();

  try {
    // fetch via redis-backed API
    const state = await fetch(getApiUrl(`/api/room-state?roomId=${roomId}`)).then(r=>r.json());
    if (!state.room) return sendMessage(chatId,"❌ Room not found.");

    const room = state.room;
    const status = (room.gameStatus || room.roomStatus || "").toLowerCase();
    const betAmount = Number(room.betAmount || 0);

    sendMessage(chatId,
      `🔁 Reset room *${roomId}*\n`+
      `Status: ${status}\n\nReply **yes** to confirm`
    );

    await pendingActions.set(userId,{ type:"awaiting_room_reset_confirm", roomId, status, betAmount });
    return;

  } catch(err){
    console.error(err);
    return sendMessage(chatId,"❌ Error reading room state.");
  }
}


// Step 3 — Confirm Reset
if (pending?.type === "awaiting_room_reset_confirm") {
  if (text.trim().toLowerCase() !== "yes") {
    await pendingActions.delete(userId);
    return sendMessage(chatId,"❌ Reset cancelled.");
  }

  const { roomId, status, betAmount } = pending;

  sendMessage(chatId,"⏳ Resetting room...");

  try {
    // stop drawing if active
    if (status === "playing"){
      try {
        gameManager.stopNumberDrawing(roomId);
      } catch(e){
        console.log("⚠ failed to stop drawing",e);
      }
    }

    // refund if required
    if (status==="playing" && betAmount>0){
      const state = await fetch(getApiUrl(`/api/room-state?roomId=${roomId}`)).then(r=>r.json());
      const players = Object.values(state.room.players||{});

      for(const p of players){
        if(!p.userId) continue;

        await fetch(getApiUrl("/api/update-user"),{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({
            telegramId:p.userId,
            balanceIncrease:betAmount  // auto refund Redis-side
          })
        }).catch(()=>{});
      }

      sendMessage(chatId,`💰 Refunded ${betAmount} to ${players.length} players.`);
    }

    // RESET ROOM USING REDIS HELPER
    await redis.set(`room:${roomId}`, JSON.stringify({
      ...room,
      gameStatus:"waiting",
      countdownEndAt:null,
      countdownStartedBy:null,
      drawnNumbers:[],
      winners:[]
    }));

    await redis.expire(`room:${roomId}`, 60*60); // optional TTL

    sendMessage(chatId,`♻ Room *${roomId}* has been reset to waiting state.`);
    
  } catch(err){
    console.error(err);
    sendMessage(chatId,"❌ Reset failed.");
  }

  await pendingActions.delete(userId);
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

if (text === "/transaction") {
  if (!ADMIN_IDS.includes(userId)) {
    sendMessage(chatId, "❌ You are not authorized to use this command.");
    return;
  }

  try {
    // Fetch transaction data
    const response = await fetch(`${getWebappUrl()}/api/transaction`);
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
  if (data === "lang_en" || data === "lang_am" || data === "lang_om") {
    let lang = "en";
    if (data === "lang_am") lang = "am";
    if (data === "lang_om") lang = "om";
  
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
    ? { accNumber: process.env.CBE_ACCOUNT_NUMBER, accHolder: "Balisa Banti Bayana" }
    : { phone: process.env.TELEBIRR_PHONE, holder: "Teshoma Sileshi" };

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


// ====================== MAIN HANDLER (Webhook mode) ======================
export default async function handler(req, res) {
  try {
    // Log incoming requests for debugging
    if (process.env.NODE_ENV === 'production') {
      console.log(`📥 Webhook received: ${req.method} ${req.path}`);
    }

    if (req.method === "POST") {
      const update = req.body;
      
      if (!update) {
        console.warn("⚠️ Empty webhook body received");
        return res.status(400).json({ ok: false, error: "Empty body" });
      }

      // Log update type for debugging
      if (process.env.NODE_ENV === 'production') {
        if (update.message) {
          console.log(`💬 Message from ${update.message.from?.id}: ${update.message.text || '[media/other]'}`);
        }
        if (update.callback_query) {
          console.log(`🔘 Callback from ${update.callback_query.from?.id}: ${update.callback_query.data}`);
        }
      }

      try {
        if (update.message) await handleUserMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      } catch (err) {
        console.error("❌ Error processing webhook update:", err);
        // Still return ok: true to prevent Telegram from retrying
        return res.json({ ok: true, error: err.message });
      }

      return res.json({ ok: true });
    }
    
    // GET request - return status
    res.status(200).json({ status: "Bot running", mode: process.env.BOT_POLLING === "true" ? "polling" : "webhook" });
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

// ====================== POLLING MODE (DEV ONLY) ======================
let pollingActive = false;
let pollOffset = 0;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;
const BASE_RETRY_DELAY = 2000; // 2 seconds

async function pollUpdates() {
  if (!pollingActive) return;

  try {
    const url = `${API}/getUpdates`;
    
    // Add timeout to fetch request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeout: 20,
        offset: pollOffset,
        allowed_updates: ["message", "callback_query"],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    
    if (data.ok && Array.isArray(data.result)) {
      // Reset error counter on success
      consecutiveErrors = 0;
      
      for (const update of data.result) {
        pollOffset = update.update_id + 1;
        try {
          if (update.message) await handleUserMessage(update.message);
          if (update.callback_query) await handleCallback(update.callback_query);
        } catch (e) {
          console.error("❌ Error handling polled update:", e);
        }
      }
      
      // Normal polling delay (1 second)
      if (pollingActive) {
        setTimeout(pollUpdates, 1000);
      }
    } else if (!data.ok) {
      console.error("⚠️ getUpdates API error:", data.description || data);
      consecutiveErrors++;
      
      // Exponential backoff on API errors
      const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, consecutiveErrors - 1), 30000);
      if (pollingActive) {
        setTimeout(pollUpdates, delay);
      }
    }
  } catch (err) {
    consecutiveErrors++;
    
    // Handle different error types
    if (err.name === 'AbortError') {
      console.warn("⏱️ Polling request timeout, retrying...");
    } else if (err.code === 'ETIMEDOUT' || err.errno === 'ETIMEDOUT') {
      console.warn("🌐 Network timeout connecting to Telegram API, retrying...");
    } else {
      console.error("⚠️ Polling error:", err.message || err);
    }
    
    // Stop polling if too many consecutive errors
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      console.error(`❌ Too many consecutive polling errors (${consecutiveErrors}). Stopping polling.`);
      console.error("💡 Check your internet connection and TELEGRAM_BOT_TOKEN.");
      pollingActive = false;
      return;
    }
    
    // Exponential backoff for network errors
    const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, consecutiveErrors - 1), 30000);
    console.log(`🔄 Retrying polling in ${delay / 1000}s... (error count: ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
    
    if (pollingActive) {
      setTimeout(pollUpdates, delay);
    }
  }
}

// ====================== AUTO-CONFIGURE WEBHOOK/POLLING ======================
async function setupBotMode() {
  const isProduction = process.env.NODE_ENV === "production";
  const usePolling = process.env.BOT_POLLING === "true" && !isProduction;

  if (usePolling) {
    // Development: Use polling
    console.log("🚀 Starting Telegram bot in long-polling mode (dev)...");
    pollingActive = true;
    pollUpdates();
  } else if (isProduction) {
    // Production: Set webhook automatically
    const webappUrl = getWebappUrl();
    const webhookUrl = `${webappUrl}/api/bot`;
    
    try {
      console.log(`🔗 Setting Telegram webhook to: ${webhookUrl}`);
      const response = await fetch(`${API}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ["message", "callback_query"],
        }),
      });

      const data = await response.json();
      
      if (data.ok) {
        console.log("✅ Webhook set successfully!");
        
        // Verify webhook info
        const infoResponse = await fetch(`${API}/getWebhookInfo`);
        const info = await infoResponse.json();
        if (info.ok) {
          console.log(`📋 Webhook info: ${JSON.stringify(info.result, null, 2)}`);
        }
      } else {
        console.error("❌ Failed to set webhook:", data);
      }
    } catch (err) {
      console.error("❌ Error setting webhook:", err);
      console.error("💡 You may need to set webhook manually:");
      console.error(`   curl -X POST "${API}/setWebhook?url=${webhookUrl}"`);
    }
  } else {
    console.log("ℹ️ Bot handler ready (webhook mode). Set webhook manually or enable polling with BOT_POLLING=true");
  }
}

// Run setup when module loads
setupBotMode();
