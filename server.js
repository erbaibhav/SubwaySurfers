import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve the Vite static build in production
app.use(express.static(join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', ({ name }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    rooms[roomId] = { host: socket.id, players: {}, state: 'lobby', seed: Math.random() };
    joinRoom(socket, roomId, name);
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    if (rooms[roomId]) {
      joinRoom(socket, roomId, name);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  const joinRoom = (socket, roomId, name) => {
    socket.join(roomId);
    rooms[roomId].players[socket.id] = { name, score: 0, alive: true, x: 0, z: 0 };
    socket.roomId = roomId;
    
    io.to(roomId).emit('roomUpdate', {
      roomId,
      host: rooms[roomId].host,
      players: rooms[roomId].players,
      state: rooms[roomId].state
    });
  };

  socket.on('startGame', () => {
    const roomId = socket.roomId;
    if (rooms[roomId] && rooms[roomId].host === socket.id) {
      rooms[roomId].state = 'playing';
      io.to(roomId).emit('gameStart', { seed: rooms[roomId].seed });
    }
  });

  socket.on('updatePlayer', (data) => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      Object.assign(rooms[roomId].players[socket.id], data);
      socket.to(roomId).emit('playerUpdated', { id: socket.id, ...data });
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      } else {
        if (rooms[roomId].host === socket.id) {
          rooms[roomId].host = Object.keys(rooms[roomId].players)[0];
        }
        io.to(roomId).emit('roomUpdate', {
          roomId,
          host: rooms[roomId].host,
          players: rooms[roomId].players,
          state: rooms[roomId].state
        });
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket.io server running on port ${PORT}`);
});
