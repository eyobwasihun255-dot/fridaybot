import { createServer } from 'http';
import { Server } from 'socket.io';
import GameManager from './game-manager.js';

const gameManager = new GameManager();

export default function createSocketServer(app) {
  const server = createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"]
    }
  });

  // Set Socket.IO instance in game manager
  gameManager.setSocketIO(io);

  io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    // Handle room joining
    socket.on('joinRoom', (roomId) => {
      socket.join(roomId);
      console.log(`👥 Socket ${socket.id} joined room ${roomId}`);
    });

    // Handle room leaving
    socket.on('leaveRoom', (roomId) => {
      socket.leave(roomId);
      console.log(`👋 Socket ${socket.id} left room ${roomId}`);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('❌ Client disconnected:', socket.id);
    });
  });

  return server;
}
