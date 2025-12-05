require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());

// Add a simple route to confirm the server is running
app.get('/', (req, res) => {
  res.send('Oddztek Backend is Online!');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from Vercel
    methods: ["GET", "POST"]
  }
});

// --- DATABASE ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB Error:', err));

const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  balance: { type: Number, default: 50 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  lastHack: { type: Number, default: 0 },
  defense: { type: Number, default: 10 }
});
const Player = mongoose.model('Player', playerSchema);

// --- GAME LOGIC ---
const LEVEL_XP_BASE = 100;
const HACK_COOLDOWN = 30000;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentUser = null;

  // 1. LOGIN
  socket.on('login', async (username) => {
    currentUser = username;
    let player = await Player.findOne({ username });
    if (!player) {
      player = await Player.create({ username });
    }
    socket.emit('player_data', player);
    socket.emit('message', { text: `Welcome, ${username}.`, type: 'system' });
  });

  // 2. MINE
  socket.on('mine', async () => {
    if (!currentUser) return;
    let player = await Player.findOne({ username: currentUser });

    const earnings = Math.floor(Math.random() * 5) + 1;
    const xpGain = 5;

    // Level Up Logic
    let newLevel = player.level;
    let newXp = player.xp + xpGain;
    if (newXp >= player.level * LEVEL_XP_BASE) {
      newLevel++;
      newXp = 0;
      socket.emit('message', { text: `LEVEL UP! You are level ${newLevel}`, type: 'special' });
    }

    player.balance += earnings;
    player.xp = newXp;
    player.level = newLevel;
    await player.save();

    socket.emit('player_data', player);
    socket.emit('message', { text: `Mined ${earnings} ODZ.`, type: 'success' });
  });

  // 3. LEADERBOARD
  socket.on('leaderboard', async () => {
    const top5 = await Player.find().sort({ balance: -1 }).limit(5);
    const list = top5.map((p, i) => `${i+1}. ${p.username}: ${p.balance} ODZ`).join('\n');
    socket.emit('message', { text: `\n=== TOP HACKERS ===\n${list}`, type: 'info' });
  });

  // 4. PVP HACK
  socket.on('hack_player', async (targetName) => {
    if (!currentUser || targetName === currentUser) return;

    const target = await Player.findOne({ username: targetName });
    if (!target) {
      socket.emit('message', { text: 'Target not found.', type: 'error' });
      return;
    }

    const attacker = await Player.findOne({ username: currentUser });
    const now = Date.now();

    if (now - attacker.lastHack < HACK_COOLDOWN) {
      socket.emit('message', { text: 'Hack cooldown active.', type: 'error' });
      return;
    }

    attacker.lastHack = now;

    // Simple 50/50 chance for now
    if (Math.random() > 0.5) {
      const stolen = Math.floor(target.balance * 0.1);
      target.balance -= stolen;
      attacker.balance += stolen;
      attacker.xp += 50;

      await target.save();
      await attacker.save();

      socket.emit('player_data', attacker);
      socket.emit('message', { text: `SUCCESS! Stole ${stolen} ODZ from ${targetName}.`, type: 'special' });
    } else {
      await attacker.save(); // Save cooldown
      socket.emit('message', { text: 'Hack failed. Firewall detected.', type: 'error' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));