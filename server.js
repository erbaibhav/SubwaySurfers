import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app    = express();
const server = createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// Serve static build (production)
app.use(express.static(join(__dirname, 'dist')));

// Multi-page routing: map clean URLs to their built HTML files
app.get('/subway-surfers', (req, res) => res.sendFile(join(__dirname, 'dist', 'subway-surfers.html')));
app.get('/drink-sort',     (req, res) => res.sendFile(join(__dirname, 'dist', 'drink-sort.html')));

// Root → hub homepage
app.get('/', (req, res) => {
  const file = join(__dirname, 'dist', 'index.html');
  res.sendFile(file, err => { if (err) res.status(404).send('Not found'); });
});

// Catch-all
app.use((req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'), err => {
    if (err) res.status(404).send('Not found');
  });
});

// ── Room store ────────────────────────────────────────────────────────────────
// rooms[roomId] = {
//   host, game ('runner'|'drink'), state ('lobby'|'playing'),
//   seed, diff, players: { [socketId]: { name, score, alive, level, progress } }
// }
const rooms = {};

function broadcastRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit('roomUpdate', {
    roomId,
    host:    room.host,
    game:    room.game,
    diff:    room.diff,
    players: room.players,
    state:   room.state,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRoomId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function joinRoom(socket, roomId, name) {
  socket.join(roomId);
  rooms[roomId].players[socket.id] = {
    name,
    score:    0,
    alive:    true,
    level:    1,
    progress: 0,
    diff:     rooms[roomId].diff,
  };
  socket.roomId = roomId;
  broadcastRoom(roomId);
}

// ── Connection ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('[connect]', socket.id);

  // ── Create room ────────────────────────────────────────────────────────
  socket.on('createRoom', ({ name, game = 'runner', diff = 'easy' }) => {
    const roomId = makeRoomId();
    rooms[roomId] = {
      host:    socket.id,
      game,
      diff,
      state:   'lobby',
      seed:    Math.random(),
      players: {},
    };
    joinRoom(socket, roomId, name);
    console.log(`[createRoom] ${roomId} game=${game} diff=${diff} host=${name}`);
  });

  // ── Join room ──────────────────────────────────────────────────────────
  socket.on('joinRoom', ({ roomId, name, game }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error', 'Room not found'); return; }
    if (room.state === 'playing') { socket.emit('error', 'Game already in progress'); return; }
    joinRoom(socket, roomId, name);
    console.log(`[joinRoom] ${roomId} player=${name}`);
  });

  // ── Rejoin (game page loaded mid-session) ──────────────────────────────
  socket.on('rejoinRoom', ({ roomId, name, game }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error', 'Room expired'); return; }
    // Re-attach socket to the room
    socket.join(roomId);
    if (!room.players[socket.id]) {
      room.players[socket.id] = { name, score: 0, alive: true, level: 1, progress: 0 };
    }
    socket.roomId = roomId;
    broadcastRoom(roomId);
    // If game already started, resend the start signal
    if (room.state === 'playing') {
      socket.emit('gameStart', { seed: room.seed, diff: room.diff });
    }
    console.log(`[rejoinRoom] ${roomId} player=${name}`);
  });

  // ── Start game ─────────────────────────────────────────────────────────
  socket.on('startGame', () => {
    const roomId = socket.roomId;
    const room   = rooms[roomId];
    if (!room || room.host !== socket.id) return;
    room.state = 'playing';
    io.to(roomId).emit('gameStart', { seed: room.seed, diff: room.diff });
    console.log(`[startGame] ${roomId}`);
  });

  // ── Runner: player state update ────────────────────────────────────────
  socket.on('updatePlayer', data => {
    const roomId = socket.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    Object.assign(room.players[socket.id], data);
    // Relay to others in room
    socket.to(roomId).emit('playerUpdated', { id: socket.id, ...data });
    // Broadcast full room update so leaderboards refresh
    broadcastRoom(roomId);
  });

  // ── Drink Sort: single move ────────────────────────────────────────────
  socket.on('drinkSortMove', ({ roomId, from, to, move, score, level, progress }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (player) {
      player.score    = score;
      player.level    = level;
      player.progress = progress;
    }
    // Broadcast updated player standings
    socket.to(roomId).emit('drinkSortPlayerUpdate', {
      roomId,
      players: room.players,
    });
  });

  // ── Drink Sort: level complete ─────────────────────────────────────────
  socket.on('drinkSortWin', ({ roomId, level, score }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[socket.id];
    if (player) {
      player.score    = score;
      player.level    = level;
      player.progress = 1;
    }
    io.to(roomId).emit('drinkSortPlayerUpdate', {
      roomId,
      players: room.players,
    });
    console.log(`[drinkSortWin] ${roomId} player=${player?.name} level=${level} score=${score}`);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    delete rooms[roomId].players[socket.id];

    if (Object.keys(rooms[roomId].players).length === 0) {
      delete rooms[roomId];
      console.log(`[deleteRoom] ${roomId} empty`);
    } else {
      // Hand off host if needed
      if (rooms[roomId].host === socket.id) {
        rooms[roomId].host = Object.keys(rooms[roomId].players)[0];
      }
      broadcastRoom(roomId);
    }
    console.log(`[disconnect] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`GameHub server running on http://localhost:${PORT}`);
});
