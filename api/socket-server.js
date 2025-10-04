import { createServer } from 'http';
import { Server } from 'socket.io';
import { gameManager } from './game-manager.js';

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
    socket.on("joinRoom", (roomId) => {
      // Leave all previous rooms before joining new one
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
          console.log(`👋 ${socket.id} left ${room}`);
        }
      }
  
      socket.join(roomId);
      console.log(`👥 ${socket.id} joined ${roomId}`);
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
