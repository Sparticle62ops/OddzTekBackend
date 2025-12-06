require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v6.0 [Singularity] Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('>> MongoDB Connected'))
  .catch(err => console.error('>> DB Error:', err));

// --- ADVANCED PLAYER SCHEMA ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 100 }, // Start with a bit of cash
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  
  // Hardware Stats (Upgradable)
  cpuLevel: { type: Number, default: 1 },      // Multiplies Mining Yield
  networkLevel: { type: Number, default: 1 },  // Reduces Cooldowns
  securityLevel: { type: Number, default: 1 }, // Increases Hack Difficulty
  
  // Inventory & State
  inventory: { type: [String], default: [] }, // ['honeypot_v1', 'decryptor_v2']
  activeHoneypot: { type: Boolean, default: false }, // If true, traps next hacker
  
  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  
  // Virtual File System (Lore)
  files: { type: [String], default: ['readme.txt'] } 
});
const Player = mongoose.model('Player', playerSchema);

// --- GLOBAL GAME CONSTANTS ---
const LEVEL_XP_REQ = 200; // XP needed per level
const MINE_DURATION = 20000; // 20 Seconds
const MINE_TICK = 5000;      // Update every 5 seconds
const BASE_MINE_COOLDOWN = 20000; // 20 Seconds rest

// In-Memory State
const ACTIVE_MINERS = new Set(); // Users currently mining
const ACTIVE_HACKS = {};         // Ongoing PvP breaches

// --- SHOP CATALOG ---
const SHOP_ITEMS = {
  // HARDWARE
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpuLevel', val: 2, desc: 'Doubles mining yield.' },
  'cpu_v3': { price: 2000, type: 'upgrade', stat: 'cpuLevel', val: 3, desc: 'Triples mining yield. Industrial grade.' },
  'network_v2': { price: 750, type: 'upgrade', stat: 'networkLevel', val: 2, desc: 'Reduces cooldowns by 20%.' },
  'firewall_v2': { price: 600, type: 'upgrade', stat: 'securityLevel', val: 2, desc: 'Increases PIN complexity.' },
  
  // SOFTWARE
  'honeypot': { price: 300, type: 'consumable', desc: 'Trap the next person who hacks you. Steals THEIR money.' },
  'auto_cracker': { price: 1500, type: 'tool', desc: 'Automatically solves 1 PIN digit during hacks.' },
  
  // SKINS
  'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro monitor style.' },
  'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon purple aesthetic.' },
  'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'The code is real.' }
};

// --- LORE FILES ---
const LORE_DB = {
  'server_log_01.txt': "FATAL ERROR 10-12-99: Core temperature critical. Automatic shutdown failed. Personnel evacuation ordered.",
  'email_archive.txt': "To: Admin\nFrom: DevTeam\nSubject: It's awake.\nWe can't stop the process. It has locked us out of the mainframe.",
  'blueprint_omega.dat': "Project Omega: Autonomous Digital Currency Generation. Status: UNCONTROLLED EXPANSION."
};

// --- HELPER FUNCTIONS ---
function getCooldown(player) {
  // Higher network level = lower cooldown (max 50% reduction)
  const reduction = Math.min(0.5, (player.networkLevel - 1) * 0.1);
  return BASE_MINE_COOLDOWN * (1 - reduction);
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
  let user = null; // Current socket user

  // 1. AUTHENTICATION
  socket.on('login', async ({ username, password }) => {
    const p = await Player.findOne({ username });
    if (!p || p.password !== password) {
      socket.emit('message', { text: 'Access Denied.', type: 'error' });
      return;
    }
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Welcome back, Agent ${username}.`, type: 'success' });
    socket.emit('play_sound', 'login');
  });

  socket.on('register', async ({ username, password }) => {
    if (await Player.findOne({ username })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
    const p = await Player.create({ username, password });
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: 'Account initialized.', type: 'success' });
  });

  // 2. MINING (Chunked)
  socket.on('mine', async () => {
    if (!user) return;
    if (ACTIVE_MINERS.has(user)) { socket.emit('message', { text: 'Mining already in progress.', type: 'error' }); return; }

    let p = await Player.findOne({ username: user });
    const now = Date.now();
    const cd = getCooldown(p);

    if (now - p.lastMine < cd) {
      const wait = Math.ceil((cd - (now - p.lastMine)) / 1000);
      socket.emit('message', { text: `Thermal Throttling: Wait ${wait}s.`, type: 'warning' });
      return;
    }

    // Start Process
    ACTIVE_MINERS.add(user);
    socket.emit('message', { text: `[MINER v${p.cpuLevel}.0] Cycle started (${MINE_DURATION/1000}s)...`, type: 'system' });
    socket.emit('play_sound', 'click');

    let ticks = 0;
    const totalTicks = MINE_DURATION / MINE_TICK; // 4 ticks

    const interval = setInterval(async () => {
      if (!ACTIVE_MINERS.has(user)) { clearInterval(interval); return; } // Stop if disconnected
      
      ticks++;
      
      // Calculate Reward
      const baseAmt = Math.floor(Math.random() * 10) + 5;
      const totalAmt = baseAmt * p.cpuLevel; // Hardware Multiplier
      
      // Update DB
      p = await Player.findOneAndUpdate(
        { username: user },
        { $inc: { balance: totalAmt, xp: 10 } },
        { new: true }
      );

      socket.emit('message', { text: `>> Chunk ${ticks}/${totalTicks} processed: +${totalAmt} ODZ`, type: 'success' });
      socket.emit('play_sound', 'coin');

      // Check Level Up
      if (p.xp >= p.level * LEVEL_XP_REQ) {
        p.level++; p.xp = 0;
        await p.save();
        socket.emit('message', { text: `*** SYSTEM UPGRADE: LEVEL ${p.level} ***`, type: 'special' });
        socket.emit('play_sound', 'success');
      }

      if (ticks >= totalTicks) {
        clearInterval(interval);
        ACTIVE_MINERS.delete(user);
        p.lastMine = Date.now();
        await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: 'Mining Cycle Complete. Cooling down.', type: 'info' });
      }
    }, MINE_TICK);
  });

  // 3. SHOP & ITEMS
  socket.on('shop', () => {
    let list = "\n=== BLACK MARKET HARDWARE ===\n";
    for (const [id, item] of Object.entries(SHOP_ITEMS)) {
      list += `[${id.padEnd(12)}] ${item.price} ODZ - ${item.desc}\n`;
    }
    socket.emit('message', { text: list, type: 'info' });
  });

  socket.on('buy', async (itemId) => {
    if (!user) return;
    const item = SHOP_ITEMS[itemId];
    if (!item) { socket.emit('message', { text: 'Item not found.', type: 'error' }); return; }

    let p = await Player.findOne({ username: user });
    if (p.balance < item.price) {
      socket.emit('message', { text: `Insufficient funds. Need ${item.price} ODZ.`, type: 'error' });
      return;
    }

    // Purchase Logic
    p.balance -= item.price;
    
    if (item.type === 'upgrade') {
      // Upgrade Hardware directly
      if (p[item.stat] >= item.val) {
        socket.emit('message', { text: 'You already have equal or better hardware.', type: 'error' });
        return; // Don't charge
      }
      p[item.stat] = item.val;
      socket.emit('message', { text: `Hardware Installed: ${itemId}`, type: 'success' });
    } else if (item.type === 'consumable') {
      // Logic for Honeypot
      if (itemId === 'honeypot') {
        p.activeHoneypot = true;
        socket.emit('message', { text: 'Honeypot Trap ARMING... System Secure.', type: 'special' });
      }
    } else {
      // Standard Inventory Item (Skins, etc)
      if (!p.inventory.includes(itemId)) p.inventory.push(itemId);
      socket.emit('message', { text: `Purchased ${itemId}. Added to Inventory.`, type: 'success' });
    }

    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
  });

  // 4. DAILY REWARD & LEADERBOARD
  socket.on('daily', async () => {
    if (!user) return;
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    
    // 24 Hour Check (86400000 ms)
    if (now - p.lastDaily < 86400000) {
      const hours = Math.ceil((86400000 - (now - p.lastDaily)) / 3600000);
      socket.emit('message', { text: `Daily reward claimed. Come back in ${hours} hours.`, type: 'warning' });
      return;
    }

    // Reward Logic
    const reward = 100 * p.level;
    p.balance += reward;
    p.lastDaily = now;
    
    // Check Top 5 Bonus
    const top5 = await Player.find().sort({ balance: -1 }).limit(5);
    const isTop = top5.some(player => player.username === user);
    
    if (isTop) {
      p.balance += 500; // Leaderboard Bonus
      socket.emit('message', { text: `ELITE HACKER BONUS: +500 ODZ`, type: 'special' });
    }

    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Daily Login: +${reward} ODZ.`, type: 'success' });
  });

  socket.on('leaderboard', async () => {
    const top = await Player.find().sort({ balance: -1 }).limit(5);
    let msg = "\n=== ELITE HACKERS (Daily Bonus Active) ===\n";
    top.forEach((p, i) => {
      msg += `#${i+1} ${p.username.padEnd(10)} | ${p.balance} ODZ | Lvl ${p.level}\n`;
    });
    socket.emit('message', { text: msg, type: 'info' });
  });

  // 5. FILE SYSTEM & LORE
  socket.on('files', async () => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    socket.emit('message', { text: `FILES IN /ROOT:\n${p.files.join('\n')}`, type: 'info' });
  });

  socket.on('read', async (filename) => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    if (!p.files.includes(filename)) { socket.emit('message', { text: 'File not found.', type: 'error' }); return; }
    
    if (LORE_DB[filename]) {
      socket.emit('message', { text: `\nOPENING ${filename}...\n\n${LORE_DB[filename]}`, type: 'system' });
    } else {
      socket.emit('message', { text: 'File corrupted or empty.', type: 'warning' });
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
