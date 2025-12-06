require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v6.1 [PVP] Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('>> MongoDB Connected'))
  .catch(err => console.error('>> DB Error:', err));

// --- SCHEMA ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  cpuLevel: { type: Number, default: 1 },
  networkLevel: { type: Number, default: 1 },
  securityLevel: { type: Number, default: 1 },
  inventory: { type: [String], default: [] },
  activeHoneypot: { type: Boolean, default: false },
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  files: { type: [String], default: ['readme.txt'] }
});
const Player = mongoose.model('Player', playerSchema);

// --- CONSTANTS ---
const LEVEL_XP_REQ = 200;
const MINE_DURATION = 20000;
const MINE_TICK = 5000;
const BASE_MINE_COOLDOWN = 20000;
const HACK_COOLDOWN = 60000; // 1 minute between hacks

// --- STATE ---
const ACTIVE_MINERS = new Set();
const ACTIVE_HACKS = {}; // { attacker: { target, pin, attempts, expires } }

// --- SHOP ---
const SHOP_ITEMS = {
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpuLevel', val: 2, desc: 'Doubles mining yield.' },
  'cpu_v3': { price: 2000, type: 'upgrade', stat: 'cpuLevel', val: 3, desc: 'Triples mining yield.' },
  'network_v2': { price: 750, type: 'upgrade', stat: 'networkLevel', val: 2, desc: 'Reduces cooldowns.' },
  'firewall_v2': { price: 600, type: 'upgrade', stat: 'securityLevel', val: 2, desc: 'Harder PINs.' },
  'honeypot': { price: 300, type: 'consumable', desc: 'Trap next hacker.' },
  'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro.' },
  'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon.' },
  'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'Hacker.' }
};

// --- LORE ---
const LORE_DB = {
  'readme.txt': "Welcome to Oddztek OS. This system is monitored.",
  'server_log_01.txt': "FATAL ERROR 10-12-99: Core temperature critical.",
  'email_archive.txt': "Subject: It's awake.\nWe can't stop the process."
};

// --- HELPERS ---
function getCooldown(p) { return Math.max(5000, BASE_MINE_COOLDOWN * (1 - (p.networkLevel - 1) * 0.1)); }
function generatePin(level) {
  const len = level === 1 ? 3 : (level === 2 ? 4 : 5);
  let pin = '';
  for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

// --- SOCKETS ---
io.on('connection', (socket) => {
  let user = null;

  // AUTH
  socket.on('login', async ({ username, password }) => {
    const p = await Player.findOne({ username });
    if (!p || p.password !== password) return socket.emit('message', { text: 'Access Denied.', type: 'error' });
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Welcome back, Agent ${username}.`, type: 'success' });
    socket.emit('play_sound', 'login');
  });

  socket.on('register', async ({ username, password }) => {
    if (await Player.findOne({ username })) return socket.emit('message', { text: 'Taken.', type: 'error' });
    const p = await Player.create({ username, password });
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: 'Account created.', type: 'success' });
  });

  // MINING
  socket.on('mine', async () => {
    if (!user || ACTIVE_MINERS.has(user)) return;
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    const cd = getCooldown(p);
    if (now - p.lastMine < cd) return socket.emit('message', { text: `Cooldown: ${Math.ceil((cd-(now-p.lastMine))/1000)}s`, type: 'warning' });

    ACTIVE_MINERS.add(user);
    socket.emit('message', { text: `[MINER v${p.cpuLevel}.0] Cycle started...`, type: 'system' });
    socket.emit('play_sound', 'click');

    let ticks = 0;
    const interval = setInterval(async () => {
      if (!ACTIVE_MINERS.has(user)) { clearInterval(interval); return; }
      ticks++;
      const amt = (Math.floor(Math.random()*5)+5) * p.cpuLevel;
      p = await Player.findOneAndUpdate({ username: user }, { $inc: { balance: amt, xp: 10 } }, { new: true });
      socket.emit('message', { text: `>> Chunk ${ticks}/4: +${amt} ODZ`, type: 'success' });
      socket.emit('play_sound', 'coin');

      if (ticks >= 4) {
        clearInterval(interval);
        ACTIVE_MINERS.delete(user);
        p.lastMine = Date.now();
        if (p.xp >= p.level * LEVEL_XP_REQ) { p.level++; p.xp=0; socket.emit('message', { text: `LEVEL UP! ${p.level}`, type: 'special' }); socket.emit('play_sound', 'success'); }
        await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: 'Cycle Complete.', type: 'info' });
      }
    }, MINE_TICK);
  });

  // SHOP
  socket.on('shop', () => {
    let list = "\n=== BLACK MARKET ===\n";
    for (const [id, item] of Object.entries(SHOP_ITEMS)) list += `[${id.padEnd(12)}] ${item.price} ODZ - ${item.desc}\n`;
    socket.emit('message', { text: list, type: 'info' });
  });

  socket.on('buy', async (id) => {
    if (!user) return;
    const item = SHOP_ITEMS[id];
    if (!item) return socket.emit('message', { text: 'Item not found.', type: 'error' });
    let p = await Player.findOne({ username: user });
    if (p.balance < item.price) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });

    p.balance -= item.price;
    if (item.type === 'upgrade') {
      if (p[item.stat] >= item.val) return socket.emit('message', { text: 'Already owned.', type: 'error' });
      p[item.stat] = item.val;
      socket.emit('message', { text: `Upgraded: ${id}`, type: 'success' });
    } else if (id === 'honeypot') {
      p.activeHoneypot = true;
      socket.emit('message', { text: 'Honeypot ARMED.', type: 'special' });
    } else {
      p.theme = item.val; // Skins
      socket.emit('message', { text: `Equipped: ${id}`, type: 'success' });
    }
    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
  });

  // DAILY
  socket.on('daily', async () => {
    if (!user) return;
    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastDaily < 86400000) return socket.emit('message', { text: 'Already claimed today.', type: 'error' });
    
    let reward = 100 * p.level;
    const top5 = await Player.find().sort({ balance: -1 }).limit(5);
    if (top5.some(x => x.username === user)) { reward += 500; socket.emit('message', { text: 'ELITE BONUS: +500', type: 'special' }); }
    
    p.balance += reward;
    p.lastDaily = Date.now();
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Daily: +${reward} ODZ`, type: 'success' });
  });

  // LEADERBOARD
  socket.on('leaderboard', async () => {
    const top = await Player.find().sort({ balance: -1 }).limit(5);
    socket.emit('message', { text: `\n=== ELITE ===\n${top.map((p,i)=>`#${i+1} ${p.username} | ${p.balance} ODZ`).join('\n')}`, type: 'info' });
  });

  // --- NEW: HACKING ---
  socket.on('hack_init', async (targetName) => {
    if (!user || targetName === user) return;
    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'Target not found.', type: 'error' });

    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastHack < HACK_COOLDOWN) return socket.emit('message', { text: 'Hack Cooldown Active.', type: 'warning' });

    // Honeypot Check
    if (target.activeHoneypot) {
      const fine = Math.floor(p.balance * 0.5);
      p.balance -= fine;
      target.activeHoneypot = false;
      target.balance += fine;
      await p.save(); await target.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `TRAP DETECTED! Honeypot drained ${fine} ODZ from you!`, type: 'error' });
      socket.emit('play_sound', 'error');
      return;
    }

    const pin = generatePin(target.securityLevel);
    ACTIVE_HACKS[user] = { target: targetName, pin, attempts: 5, expires: Date.now() + 30000 };
    socket.emit('message', { text: `BREACH STARTED. PIN Length: ${pin.length}. Time: 30s.\nType: guess [number]`, type: 'special' });
    socket.emit('play_sound', 'login');
  });

  socket.on('guess', async (val) => {
    const session = ACTIVE_HACKS[user];
    if (!session) return socket.emit('message', { text: 'No active hack.', type: 'error' });
    if (Date.now() > session.expires) { delete ACTIVE_HACKS[user]; return socket.emit('message', { text: 'Time expired.', type: 'error' }); }

    if (val === session.pin) {
      // SUCCESS
      delete ACTIVE_HACKS[user];
      const t = await Player.findOne({ username: session.target });
      const p = await Player.findOne({ username: user });
      const stolen = Math.floor(t.balance * 0.2);
      t.balance -= stolen; p.balance += stolen; p.lastHack = Date.now();
      
      // File Drop Chance
      if (Math.random() > 0.7) {
        const secretFile = 'server_log_01.txt';
        if (!p.files.includes(secretFile)) p.files.push(secretFile);
        socket.emit('message', { text: `DATA DUMP RECOVERED: ${secretFile}`, type: 'special' });
      }

      await t.save(); await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `ACCESS GRANTED. Stole ${stolen} ODZ.`, type: 'success' });
      socket.emit('play_sound', 'success');
    } else {
      // FAIL
      session.attempts--;
      if (session.attempts <= 0) { delete ACTIVE_HACKS[user]; socket.emit('message', { text: 'Lockout.', type: 'error' }); return; }
      socket.emit('message', { text: `Incorrect. ${val < session.pin ? 'HIGHER' : 'LOWER'}. Tries: ${session.attempts}`, type: 'warning' });
    }
  });

  // --- NEW: FILE SYSTEM ---
  socket.on('files', async () => {
    if (!user) return;
    const p = await Player.findOne({ username: user });
    socket.emit('message', { text: `\n/ROOT:\n${p.files.join('\n')}`, type: 'info' });
  });

  socket.on('read', async (file) => {
    if (!user) return;
    const p = await Player.findOne({ username: user });
    if (p.files.includes(file) && LORE_DB[file]) socket.emit('message', { text: `\n> ${file}\n${LORE_DB[file]}`, type: 'system' });
    else socket.emit('message', { text: 'File corrupted or missing.', type: 'error' });
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT);
