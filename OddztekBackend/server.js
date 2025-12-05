require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());

// Root route for health check
app.get('/', (req, res) => res.send('Oddztek Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- DATABASE ---
// Ensure MONGO_URI is set in your Environment Variables!
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB Error:', err));

const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }, // Added Password
  balance: { type: Number, default: 50 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  lastHack: { type: Number, default: 0 },
  inventory: { type: [String], default: [] }, // Inventory
  theme: { type: String, default: 'green' }
});
const Player = mongoose.model('Player', playerSchema);

// --- GAME LOGIC ---
const LEVEL_XP_BASE = 100;
const HACK_COOLDOWN = 30000;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentUser = null;

  // 1. REGISTER
  socket.on('register', async ({ username, password }) => {
    try {
      const existing = await Player.findOne({ username });
      if (existing) {
        socket.emit('message', { text: `Error: User '${username}' already exists.`, type: 'error' });
        return;
      }
      const newPlayer = await Player.create({ username, password });
      currentUser = username;
      socket.emit('player_data', newPlayer);
      socket.emit('message', { text: `Registration successful. Welcome agent ${username}.`, type: 'success' });
    } catch (err) {
      socket.emit('message', { text: 'Registration failed.', type: 'error' });
    }
  });

  // 2. LOGIN
  socket.on('login', async ({ username, password }) => {
    try {
      const player = await Player.findOne({ username });
      if (!player) {
        socket.emit('message', { text: `User '${username}' not found. Type "register [name] [pass]" to create.`, type: 'error' });
        return;
      }
      if (player.password !== password) {
        socket.emit('message', { text: 'Access Denied: Invalid Password.', type: 'error' });
        return;
      }
      currentUser = username;
      socket.emit('player_data', player);
      socket.emit('message', { text: `Login verified. Welcome back, ${username}.`, type: 'success' });
    } catch (err) {
      socket.emit('message', { text: 'Login error.', type: 'error' });
    }
  });

  // 3. MINE
  socket.on('mine', async () => {
    if (!currentUser) {
      socket.emit('message', { text: 'Authentication required.', type: 'error' });
      return;
    }

    let player = await Player.findOne({ username: currentUser });

    // Simple mining logic (upgrade later for the 40s duration)
    const earnings = Math.floor(Math.random() * 10) + 5;
    const xpGain = 10;

    // Level Up Check
    let newLevel = player.level;
    let newXp = player.xp + xpGain;
    if (newXp >= player.level * LEVEL_XP_BASE) {
      newLevel++;
      newXp = 0;
      socket.emit('message', { text: `*** SYSTEM UPGRADE: LEVEL ${newLevel} ***`, type: 'special' });
    }

    player.balance += earnings;
    player.xp = newXp;
    player.level = newLevel;
    await player.save();

    socket.emit('player_data', player);
    socket.emit('message', { text: `Data mined. Yield: ${earnings} ODZ.`, type: 'success' });
  });

  // 4. LEADERBOARD
  socket.on('leaderboard', async () => {
    const top = await Player.find().sort({ balance: -1 }).limit(5);
    const list = top.map((p, i) => `${i+1}. ${p.username} - ${p.balance} ODZ (Lvl ${p.level})`).join('\n');
    socket.emit('message', { text: `\n=== TOP HACKERS ===\n${list}`, type: 'info' });
  });

  // 5. SHOP (List Items)
  socket.on('shop', () => {
    socket.emit('message', { text: `
=== ODDZTEK MARKET ===
[SKINS]
  amber   - 100 ODZ
  plasma  - 250 ODZ
  matrix  - 500 ODZ
[TOOLS]
  firewall - 1000 ODZ (Blocks 1 hack)
    `, type: 'info' });
  });

  // 6. BUY
  socket.on('buy', async (item) => {
    if (!currentUser) return;
    let player = await Player.findOne({ username: currentUser });
    let cost = 0;

    if (item === 'amber') cost = 100;
    else if (item === 'plasma') cost = 250;
    else if (item === 'matrix') cost = 500;
    else if (item === 'firewall') cost = 1000;
    else {
      socket.emit('message', { text: 'Item not found.', type: 'error' });
      return;
    }

    if (player.balance >= cost) {
      player.balance -= cost;
      player.inventory.push(item);
      if (['amber', 'plasma', 'matrix'].includes(item)) player.theme = item; // Auto-equip skin
      await player.save();
      socket.emit('player_data', player);
      socket.emit('message', { text: `Purchased ${item}.`, type: 'success' });
    } else {
      socket.emit('message', { text: `Insufficient funds. Need ${cost} ODZ.`, type: 'error' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));