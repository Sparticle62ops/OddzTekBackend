require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v7.0 [Encryption] Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('>> MongoDB Connected'))
  .catch(err => console.error('>> DB Error:', err));

// --- PLAYER SCHEMA ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  theme: { type: String, default: 'green' },
  
  // Hardware Stats
  cpuLevel: { type: Number, default: 1 },      // Mining Yield
  networkLevel: { type: Number, default: 1 },  // Cooldown Reduction
  securityLevel: { type: Number, default: 1 }, // PIN Complexity
  
  // Inventory & State
  inventory: { type: [String], default: [] }, 
  activeHoneypot: { type: Boolean, default: false },
  
  // Communications
  inbox: { type: [{ from: String, msg: String, date: { type: Date, default: Date.now } }], default: [] },

  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  
  // File System
  files: { type: [String], default: ['readme.txt'] } 
});
const Player = mongoose.model('Player', playerSchema);

// --- CONSTANTS ---
const LEVEL_XP_REQ = 200;
const MINE_DURATION = 20000;
const MINE_TICK = 5000;
const BASE_MINE_COOLDOWN = 20000;
const HACK_COOLDOWN = 60000;

// --- STATE ---
const ACTIVE_MINERS = new Set(); 
const ACTIVE_HACKS = {}; // { user: { target, pin, attempts, expires, known: [] } }

// --- SHOP CATALOG ---
const SHOP_ITEMS = {
  // HARDWARE
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpuLevel', val: 2, desc: 'Doubles mining yield.' },
  'cpu_v3': { price: 2000, type: 'upgrade', stat: 'cpuLevel', val: 3, desc: 'Triples mining yield.' },
  'network_v2': { price: 750, type: 'upgrade', stat: 'networkLevel', val: 2, desc: 'Reduces cooldowns.' },
  'firewall_v2': { price: 600, type: 'upgrade', stat: 'securityLevel', val: 2, desc: 'Increases PIN length (4 digits).' },
  'firewall_v3': { price: 1500, type: 'upgrade', stat: 'securityLevel', val: 3, desc: 'Maximum Security (5 digits).' },
  
  // TOOLS
  'honeypot': { price: 300, type: 'consumable', desc: 'Trap next hacker. Steals 50% of their balance.' },
  'decryptor_v1': { price: 800, type: 'tool', desc: 'Passive: Reveals 1 random digit at hack start.' },
  'cloak_v1': { price: 1200, type: 'tool', desc: 'Passive: Hides name from Leaderboard.' },

  // SKINS
  'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro monitor style.' },
  'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon purple aesthetic.' },
  'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'The code is real.' }
};

// --- LORE ---
const LORE_DB = {
  'readme.txt': "Welcome to Oddztek OS. This system is monitored. Unauthorized access is prohibited.",
  'server_log_01.txt': "FATAL ERROR 10-12-99: Core temperature critical. Automatic shutdown failed.",
  'email_archive.txt': "Subject: It's awake.\nWe can't stop the process. It has locked us out of the mainframe.",
  'blueprint_omega.dat': "Project Omega: Autonomous Digital Currency Generation. Status: UNCONTROLLED EXPANSION."
};

// --- HELPERS ---
function getCooldown(p) { return Math.max(5000, BASE_MINE_COOLDOWN * (1 - (p.networkLevel - 1) * 0.1)); }

function generatePin(level) {
  const len = level === 1 ? 3 : (level === 2 ? 4 : 5);
  let pin = '';
  for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
  let user = null;

  // 1. AUTH
  socket.on('login', async ({ username, password }) => {
    try {
      const p = await Player.findOne({ username });
      if (!p || p.password !== password) return socket.emit('message', { text: 'Access Denied.', type: 'error' });
      user = username;
      socket.emit('player_data', p);
      socket.emit('message', { text: `Welcome back, Agent ${username}.`, type: 'success' });
      
      // Notify if unread mail
      if (p.inbox.length > 0) socket.emit('message', { text: `[!] You have ${p.inbox.length} unread messages. Type 'mail check'.`, type: 'special' });
      
      socket.emit('play_sound', 'login');
    } catch (e) { console.error(e); }
  });

  socket.on('register', async ({ username, password }) => {
    try {
      if (await Player.findOne({ username })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
      const p = await Player.create({ username, password });
      user = username;
      socket.emit('player_data', p);
      socket.emit('message', { text: 'Account created.', type: 'success' });
    } catch (e) { console.error(e); }
  });

  // 2. MINING
  socket.on('mine', async () => {
    if (!user || ACTIVE_MINERS.has(user)) return;
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    const cd = getCooldown(p);
    
    if (now - p.lastMine < cd) {
        const wait = Math.ceil((cd - (now - p.lastMine))/1000);
        return socket.emit('message', { text: `System Overheated. Wait ${wait}s.`, type: 'warning' });
    }

    ACTIVE_MINERS.add(user);
    socket.emit('message', { text: `[MINER v${p.cpuLevel}.0] Cycle started (${MINE_DURATION/1000}s)...`, type: 'system' });
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

  // 3. SHOP
  socket.on('shop', () => {
    let list = "\n=== BLACK MARKET ===\n";
    for (const [id, item] of Object.entries(SHOP_ITEMS)) list += `[${id.padEnd(14)}] ${item.price} ODZ - ${item.desc}\n`;
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
      if (p[item.stat] >= item.val) return socket.emit('message', { text: 'Already owned/better installed.', type: 'error' });
      p[item.stat] = item.val;
      socket.emit('message', { text: `Upgraded: ${id}`, type: 'success' });
    } else if (id === 'honeypot') {
      p.activeHoneypot = true;
      socket.emit('message', { text: 'Honeypot ARMED.', type: 'special' });
    } else {
      if (!p.inventory.includes(id)) p.inventory.push(id);
      if (item.type === 'skin') p.theme = item.val;
      socket.emit('message', { text: `Purchased: ${id}`, type: 'success' });
    }
    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
  });

  // 4. DAILY & LEADERBOARD
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

  socket.on('leaderboard', async () => {
    const all = await Player.find();
    // Filter out cloaked users
    const visible = all.filter(p => !p.inventory.includes('cloak_v1'));
    const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
    
    socket.emit('message', { text: `\n=== ELITE HACKERS ===\n${top.map((p,i)=>`#${i+1} ${p.username} | ${p.balance} ODZ`).join('\n')}`, type: 'info' });
  });

  // 5. PVP HACKING (V7.0 Logic)
  socket.on('hack_init', async (targetName) => {
    if (!user || targetName === user) return;
    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'Target offline/not found.', type: 'error' });

    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastHack < HACK_COOLDOWN) return socket.emit('message', { text: 'Hack Cooldown Active.', type: 'warning' });

    if (target.activeHoneypot) {
      const fine = Math.floor(p.balance * 0.5);
      p.balance -= fine;
      target.activeHoneypot = false;
      target.balance += fine;
      await p.save(); await target.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `TRAP DETECTED! Honeypot drained ${fine} ODZ!`, type: 'error' });
      socket.emit('play_sound', 'error');
      return;
    }

    const pin = generatePin(target.securityLevel);
    let known = Array(pin.length).fill('*');
    let extraMsg = "";

    // Decryptor Tool Check
    if (p.inventory.includes('decryptor_v1')) {
        const idx = Math.floor(Math.random() * pin.length);
        known[idx] = pin[idx];
        extraMsg = `\n[DECRYPTOR] Revealed digit at pos ${idx+1}`;
    }

    ACTIVE_HACKS[user] = { target: targetName, pin, attempts: 6, expires: Date.now() + 45000, known };
    socket.emit('message', { 
      text: `BREACH STARTED on ${targetName}.\nPIN: [ ${known.join(' ')} ]${extraMsg}\nTime: 45s. Type: guess [pin]`, 
      type: 'special' 
    });
    socket.emit('play_sound', 'login');
  });

  socket.on('guess', async (val) => {
    const session = ACTIVE_HACKS[user];
    if (!session) return socket.emit('message', { text: 'No active hack.', type: 'error' });
    if (Date.now() > session.expires) { delete ACTIVE_HACKS[user]; return socket.emit('message', { text: 'Timed out.', type: 'error' }); }
    
    if (val.length !== session.pin.length) return socket.emit('message', { text: `Error: PIN must be ${session.pin.length} digits.`, type: 'error' });

    if (val === session.pin) {
      // SUCCESS
      delete ACTIVE_HACKS[user];
      const t = await Player.findOne({ username: session.target });
      const p = await Player.findOne({ username: user });
      const stolen = Math.floor(t.balance * 0.25); // 25%
      t.balance -= stolen;
      p.balance += stolen;
      p.lastHack = Date.now();
      p.xp += 50;

      // Rare File Drop
      if (Math.random() > 0.8) {
        const secretFile = 'server_log_01.txt';
        if (!p.files.includes(secretFile)) p.files.push(secretFile);
        socket.emit('message', { text: `DATA DUMP RECOVERED: ${secretFile}`, type: 'special' });
      }

      await t.save(); await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `ACCESS GRANTED. Stole ${stolen} ODZ.`, type: 'success' });
      socket.emit('play_sound', 'success');
    } else {
      // FAIL - Digit Reveal Logic
      session.attempts--;
      if (session.attempts <= 0) { delete ACTIVE_HACKS[user]; socket.emit('message', { text: 'Lockout.', type: 'error' }); return; }

      // Check for partial matches
      let matched = false;
      for(let i=0; i<session.pin.length; i++) {
          if(val[i] === session.pin[i] && session.known[i] === '*') {
              session.known[i] = val[i];
              matched = true;
          }
      }

      // Hint
      const diff = Math.abs(parseInt(val) - parseInt(session.pin));
      let hint = diff <= 20 ? "BURNING HOT" : (diff <= 50 ? "HOT" : (diff <= 100 ? "WARM" : "COLD"));
      const dir = val < session.pin ? "(Higher)" : "(Lower)";

      let msg = `Incorrect. Signal: ${hint} ${dir}.`;
      if(matched) msg += `\n[!] DIGIT MATCHED! PIN: [ ${session.known.join(' ')} ]`;
      else msg += `\nPIN State: [ ${session.known.join(' ')} ]`;
      msg += `\nTries: ${session.attempts}`;

      socket.emit('message', { text: msg, type: 'warning' });
    }
  });

  // 6. MAIL & FILES
  socket.on('mail_send', async ({ recipient, message }) => {
      if (!user) return;
      const t = await Player.findOne({ username: recipient });
      if (!t) return socket.emit('message', { text: 'User not found.', type: 'error' });
      t.inbox.push({ from: user, msg: message });
      await t.save();
      socket.emit('message', { text: 'Sent.', type: 'success' });
  });

  socket.on('mail_check', async () => {
      if (!user) return;
      const p = await Player.findOne({ username: user });
      if (!p.inbox.length) return socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
      socket.emit('message', { text: `\n=== INBOX ===\n${p.inbox.map((m,i)=>`[${i+1}] From: ${m.from} | "${m.msg}"`).join('\n')}`, type: 'info' });
  });

  socket.on('files', async () => {
    if (!user) return;
    const p = await Player.findOne({ username: user });
    socket.emit('message', { text: `\n/ROOT:\n${p.files.join('\n')}`, type: 'info' });
  });

  socket.on('read', async (file) => {
    if (!user) return;
    const p = await Player.findOne({ username: user });
    if (p.files.includes(file) && LORE_DB[file]) socket.emit('message', { text: `\n> ${file}\n${LORE_DB[file]}`, type: 'system' });
    else socket.emit('message', { text: 'File corrupted/missing.', type: 'error' });
  });

  socket.on('scan_player', async (target) => {
      if (!user) return;
      const t = await Player.findOne({ username: target });
      if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
      socket.emit('message', { text: `SCAN [${target}]:\nLvl: ${t.level} | Firewall: v${t.securityLevel}.0`, type: 'system' });
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
