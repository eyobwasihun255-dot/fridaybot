#!/bin/bash

echo "🚀 Deploying Friday Bingo to Render..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the frontend
echo "🏗️ Building frontend..."
npm run build

# Start the server
echo "🎮 Starting game server..."
npm run server
