# Friday Bingo - Server Deployment Guide

## Overview

This project has been migrated from client-side game logic to server-side game management for better reliability and scalability on Render.

## Architecture Changes

### Before (Client-Side)
- Game countdown logic in client
- Number drawing in client intervals
- Bingo validation in client
- Game state management in client

### After (Server-Side)
- **Game Manager**: Centralized server-side game lifecycle
- **Socket.IO**: Real-time communication
- **Auto-start**: Server automatically starts games when countdown ends
- **Auto-reset**: Server automatically resets rooms after games end
- **Server Validation**: All game logic validated on server

## New Server Components

### 1. Game Manager (`api/game-manager.js`)
- Handles game start/end logic
- Manages number drawing process
- Validates bingo claims
- Processes winners and payouts
- Manages room resets

### 2. API Endpoints
- `api/start-game.js` - Start a new game
- `api/end-game.js` - End current game
- `api/check-bingo.js` - Validate bingo claims
- `api/reset-room.js` - Reset room for next game

### 3. Socket.IO Server (`api/socket-server.js`)
- Real-time game updates
- Number drawing notifications
- Game state changes
- Winner announcements

### 4. Main Server (`api/server.js`)
- Express server with Socket.IO
- Auto-start games when countdown ends
- Auto-reset rooms after games end
- Health check endpoint

## Deployment to Render

### 1. Environment Variables
Set these in your Render dashboard:

```
NODE_ENV=production
PORT=10000
CLIENT_URL=https://your-frontend-url.com
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_IDS=your_admin_ids
WEBAPP_URL=https://your-frontend-url.com
```

### 2. Build Configuration
- **Build Command**: `npm install`
- **Start Command**: `npm run server`
- **Health Check Path**: `/health`

### 3. Dependencies
The following new dependencies have been added:
- `socket.io` - Real-time communication
- `uuid` - Unique ID generation

## Client-Side Changes

### Removed Client Logic
- Countdown management (now server-side)
- Game state transitions (now server-side)
- Number drawing intervals (now server-side)

### Updated Client Logic
- Socket.IO connection for real-time updates
- Server-side bingo validation
- Listen for server events instead of managing game state

## Game Flow

1. **Room Join**: Client joins room via Socket.IO
2. **Countdown**: Server manages countdown automatically
3. **Game Start**: Server starts game and begins number drawing
4. **Number Drawing**: Server draws numbers every 5 seconds
5. **Bingo Check**: Client sends bingo claim to server for validation
6. **Game End**: Server ends game and processes winners
7. **Room Reset**: Server resets room for next game

## Benefits

1. **Reliability**: Game logic can't be manipulated by clients
2. **Scalability**: Server handles multiple rooms simultaneously
3. **Consistency**: All players see the same game state
4. **Security**: Server validates all game actions
5. **Performance**: Reduced client-side processing

## Monitoring

- Health check: `GET /health`
- Server logs show game events
- Socket.IO connection status
- Firebase real-time updates

## Troubleshooting

### Common Issues
1. **Socket.IO Connection**: Check CLIENT_URL environment variable
2. **Game Not Starting**: Check server logs for countdown logic
3. **Bingo Not Working**: Verify server validation logic
4. **Room Not Resetting**: Check auto-reset timer

### Debug Commands
```bash
# Check server status
curl https://your-app.onrender.com/health

# View server logs
# Check Render dashboard logs
```

## Development

### Local Development
```bash
# Install dependencies
npm install

# Start server
npm run server

# Start frontend (separate terminal)
npm run dev
```

### Testing
- Test Socket.IO connection
- Verify game auto-start
- Test bingo validation
- Check room reset functionality

## Production Checklist

- [ ] Environment variables set
- [ ] Socket.IO CORS configured
- [ ] Firebase rules updated
- [ ] Client URL configured
- [ ] Health check working
- [ ] Game auto-start working
- [ ] Room auto-reset working
- [ ] Bingo validation working
