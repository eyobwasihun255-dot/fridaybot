# Friday Bingo - Telegram Mini App

A comprehensive Telegram Bot with Bingo Mini App featuring real-time multiplayer gameplay, payment processing, and admin controls.

## 🎯 Features

### Telegram Bot
- `/playgame` - Launch the mini app
- `/deposit` - Add funds via CBE/Telebirr (Amharic flow)
- `/withdraw` - Withdraw winnings with admin approval (Amharic flow)
- Admin commands for room and balance management

### Mini App
- Bilingual support (English/Amharic)
- Real-time multiplayer bingo games
- Multiple game rooms with different bet amounts
- Demo room for free play
- Professional UI with smooth animations
- Balance management and payout system

### Game Features
- 100 unique bingo cards per room
- Standard B-I-N-G-O format (1-75 numbers)
- Real-time number calling and marking
- Automatic winner validation
- 90% payout to winners
- Minimum 2 players to start

## 🚀 Setup Instructions

### 1. Telegram Bot Setup

1. Create a new bot via [@BotFather](https://t.me/botfather)
2. Get your bot token and add it to `.env`
3. Set bot commands using BotFather:
   ```
   playgame - Launch the bingo mini app
   deposit - Add funds to your account
   withdraw - Withdraw your winnings
   ```

### 2. Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Firestore Database
3. Copy configuration to `.env` file
4. Deploy Firestore rules from `firebase.rules`

### 3. Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start the React app
npm run dev

# Start the bot server (separate terminal)
npm run bot
```

### 4. Deployment

#### Vercel Deployment
1. Connect your GitHub repo to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on push

#### Bot Server
- Deploy bot server to Railway, Heroku, or VPS
- Ensure webhook URL is accessible
- Update `WEBAPP_URL` in environment

## 📱 Usage

### For Players
1. Start the bot: `/start`
2. Launch game: `/playgame`
3. Select a room and place bets
4. Play bingo and win prizes!
5. Deposit funds: `/deposit`
6. Withdraw winnings: `/withdraw`

### For Admins
- Create rooms: `/admin_create_room`
- Adjust balances: `/admin_balance username amount`
- Approve withdrawals via bot notifications

## 🎮 Game Rules

### Bingo Cards
- 5x5 grid with FREE center space
- B column: 1-15
- I column: 16-30
- N column: 31-45
- G column: 46-60
- O column: 61-75

### Winning Patterns
- Any complete row
- Any complete column
- Any diagonal

### Payouts
- Winner gets 90% of total pot
- 10% house edge
- Demo room: Free play, no real money

## 🔧 Technical Stack

- **Frontend**: React + TypeScript + TailwindCSS
- **State Management**: Zustand
- **Database**: Firebase Firestore
- **Bot**: Node.js + node-telegram-bot-api
- **Hosting**: Vercel (Frontend) + Railway/Heroku (Bot)
- **Payments**: CBE Banking + Telebirr integration

## 🌐 Environment Variables

### For Vercel Deployment (Frontend)
Set these in your Vercel dashboard under Project Settings > Environment Variables:

```env
# Firebase (Client-side - VITE_ prefix required)
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### For Bot Server (Railway/Heroku/VPS)
Set these in your server environment:

```env
# Firebase (Server-side - no VITE_ prefix)
FIREBASE_API_KEY=your_api_key_here
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_DATABASE_URL=https://your_project.firebaseio.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_here
WEBAPP_URL=https://your_vercel_app.vercel.app
ADMIN_IDS=123456789,987654321

# Server
PORT=3001
```

### Local Development
Create a `.env` file in your project root with both sets of variables.

## 📄 License

Created by **BOLT4L** - Production-ready Telegram Mini App for Friday Bingo.

## 🆘 Support

For issues and support:
1. Check the console for error messages
2. Verify Firebase configuration
3. Ensure bot token is valid
4. Check network connectivity

---

**Friday Bingo** - Where every Friday is a winning Friday! 🎯