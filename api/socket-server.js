import { createServer } from "http";
import { Server } from "socket.io";
import { gameManager } from "./game-manager.js";

export default function createSocketServer(app) {
  const server = createServer(app);

  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL ,
      methods: ["GET", "POST"],
    },
  });

  // 🔧 Set Socket.IO instance in the Game Manager
  gameManager.setSocketIO(io);

  io.on("connection", (socket) => {

    // ✅ Safely handle joining a room
    socket.on("joinRoom", (roomId) => {
      if (!roomId) return;

      // Leave all previously joined rooms (except its own)
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
          console.log(`👋 ${socket.id} left ${room}`);
        }
      }

      socket.join(roomId);
      console.log(`👥 ${socket.id} joined room ${roomId}`);

      // (Optional) Acknowledge join
      socket.emit("joinedRoom", { roomId });
    });

    // ✅ Allow frontend to manually leave a specific room
    socket.on("leaveRoom", (roomId) => {
      if (!roomId) return;
      socket.leave(roomId);
      console.log(`🚪 Socket ${socket.id} left room ${roomId}`);
    });

    // ✅ Allow frontend to force-leave all joined rooms
    socket.on("leaveAllRooms", () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
          console.log(`🚪 Socket ${socket.id} left ${room} (via leaveAllRooms)`);
        }
      }
    });

    // ✅ Handle disconnection
    socket.on("disconnect", (reason) => {
      console.log(`❌ Client disconnected: ${socket.id} (${reason})`);
    });
  });

  return server;
}
