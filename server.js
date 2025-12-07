require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

// --- SERVER SETUP ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- DATABASE ---
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://user:pass@cluster.mongodb.net/oddztek')
  .then(() => console.log('>> DB CONNECTED'))
  .catch(err => console.error('>> DB ERROR', err));

// --- SCHEMAS ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String },
  
  // Economy & Stats
  balance: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  reputation: { type: Number, default: 0 },
  
  // Hardware
  cpu: { type: Number, default: 1 },
  network: { type: Number, default: 1 },
  security: { type: Number, default: 1 },
  botnet: { type: Number, default: 0 }, // Passive Income
  bounty: { type: Number, default: 0 }, // PVP Bounty

  // Inventory & State
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  faction: { type: String, default: null },
  
  // File System (Restored)
  files: { type: [String], default: ['readme.txt', 'sys_log.dat'] },
  
  // Communication
  inbox: { type: [{ 
    from: String, 
    subject: String, 
    body: String, 
    read: Boolean, 
    timestamp: Number 
  }], default: [] },

  // Cooldowns & Status
  lastMine: { type: Number, default: 0 },
  activeHoneypot: { type: Boolean, default: false },
  isSpoofed: { type: Boolean, default: false },
  hasLogicBomb: { type: Boolean, default: false }
});
const Player = mongoose.model('Player', playerSchema);

const factionSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  leader: String,
  members: [String],
});
const Faction = mongoose.model('Faction', factionSchema);

// --- CONFIGURATION ---
const SHOP = {
  // Upgrades
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpu', val: 2, desc: 'Mining Yield x2' },
  'net_v2': { price: 1000, type: 'upgrade', stat: 'network', val: 2, desc: 'Faster Cooldowns' },
  'sec_v2': { price: 1000, type: 'upgrade', stat: 'security', val: 2, desc: 'Longer PINs' },
  'bot_node': { price: 2500, type: 'bot', desc: 'Passive Income (+20 ODZ/min)' },
  
  // Tools
  'brute_v1': { price: 2000, type: 'tool', desc: 'Auto-crack 1 digit during hack' },
  'spoofer': { price: 3500, type: 'consumable', desc: 'Mask IP for 10m' },
  'logic_bomb': { price: 5000, type: 'consumable', desc: 'Destroy target\'s next mine' },
  'honeypot': { price: 500, type: 'consumable', desc: 'Trap hackers (Stun + Fine)' },
  
  // Skins
  'theme_amber': { price: 200, type: 'skin', val: 'amber', desc: 'Retro Amber Theme' },
  'theme_plasma': { price: 500, type: 'skin', val: 'plasma', desc: 'Neon Plasma Theme' },
  'theme_matrix': { price: 1000, type: 'skin', val: 'matrix', desc: 'Hacker Rain Theme' }
};

const FILE_CONTENTS = {
  'readme.txt': "Welcome to Oddztek OS v10.2.\nUse 'help' to see commands.\nWARNING: System is monitored.",
  'sys_log.dat': "KERNEL PANIC: Connection unstable.\nRetrying uplink... SUCCESS.",
  'payload.exe': "BINARY DATA: [010101011100101...]"
};

const SERVER_MAP = {
  'lobby': { desc: "Public Access Lobby. Exits: [north]", exits: { north: 'firewall' } },
  'firewall': { desc: "Red glowing barrier. Exits: [south, north]. Req: [brute_v1]", locked: true, req: 'brute_v1', exits: { south: 'lobby', north: 'core' } },
  'core': { desc: "THE CORE. Type 'nav s' to leave. DATA DOWNLOAD PENDING...", exits: { south: 'firewall' }, isGoal: true }
};

const DIR_MAP = { n: 'north', s: 'south', e: 'east', w: 'west' };

// --- STATE MEMORY ---
let ACTIVE_HACKS = {}; 
let ADVENTURE_SESSIONS = {};

// --- PASSIVE INCOME LOOP (Botnet) ---
setInterval(async () => {
  try {
    const players = await Player.find({ botnet: { $gt: 0 } });
    for (const p of players) {
      p.balance += (p.botnet * 20);
      await p.save();
    }
  } catch(e) { console.error("Botnet Error", e); }
}, 60000);

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
  let user = null;

  // --- HELPER: MAIL ---
  const sendMail = async (targetUser, from, subject, body) => {
    try {
      const p = await Player.findOne({ username: targetUser });
      if(p) {
        p.inbox.unshift({ from, subject, body, read: false, timestamp: Date.now() });
        await p.save();
        return true;
      }
      return false;
    } catch(e) { return false; }
  };

  // --- AUTH ---
  socket.on('register', async ({ username, password }) => {
    try {
      if (await Player.findOne({ username })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
      const p = new Player({ username, password });
      await p.save();
      sendMail(username, "The Broker", "Job Offer", "Get to Level 2. I have work for you.");
      socket.emit('message', { text: 'Account created. Please login.', type: 'success' });
    } catch(e) { socket.emit('message', { text: 'DB Error.', type: 'error' }); }
  });

  socket.on('login', async ({ username, password }) => {
    try {
      const p = await Player.findOne({ username, password });
      if (!p) return socket.emit('message', { text: 'Invalid credentials.', type: 'error' });
      
      p.token = crypto.randomBytes(16).toString('hex');
      await p.save();
      user = username;
      socket.emit('player_data', p);
      socket.emit('message', { text: `Identity Verified. Welcome, ${username}.`, type: 'success' });
      socket.emit('play_sound', 'login');
    } catch(e) { socket.emit('message', { text: 'Login Error.', type: 'error' }); }
  });

  socket.on('login_token', async (token) => {
    try {
      const p = await Player.findOne({ token });
      if (!p) return socket.emit('message', { text: 'Session expired.', type: 'error' });
      user = p.username;
      socket.emit('player_data', p);
      socket.emit('message', { text: `Biometrics Confirmed. Welcome back ${user}.`, type: 'success' });
    } catch(e) { socket.emit('message', { text: 'Token Error.', type: 'error' }); }
  });

  // --- ECONOMY ---
  socket.on('mine', async () => {
    if (!user) return;
    try {
      let p = await Player.findOne({ username: user });
      
      // Logic Bomb Check
      if (p.hasLogicBomb) {
        p.balance = Math.floor(p.balance / 2);
        p.hasLogicBomb = false;
        await p.save();
        socket.emit('player_data', p);
        return socket.emit('message', { text: 'CRITICAL FAILURE: LOGIC BOMB DETONATED.', type: 'error' });
      }

      const cooldown = 5000 / p.network; // Network level reduces cooldown
      if (Date.now() - p.lastMine < cooldown) return socket.emit('message', { text: 'System cooling down...', type: 'warning' });
      
      const gain = 10 * p.cpu;
      p.balance += gain;
      p.xp += 10;
      p.lastMine = Date.now();
      
      // Level Up
      if(p.xp >= p.level * 100) { 
        p.level++; 
        p.xp = 0; 
        socket.emit('message', { text: `LEVEL UP! Access Level ${p.level} granted.`, type: 'special' }); 
        socket.emit('play_sound', 'success');
      }
      
      await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `Mined +${gain} ODZ`, type: 'success' });
    } catch(e) { console.error(e); }
  });

  socket.on('coinflip', async ({ side, amount }) => {
    if(!user) return;
    try {
        const amt = parseInt(amount);
        if(isNaN(amt) || amt <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
        
        let p = await Player.findOne({ username: user });
        if(p.balance < amt) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });

        const result = Math.random() > 0.5 ? 'heads' : 'tails';
        const win = (side.toLowerCase() === result);

        if(win) {
            p.balance += amt;
            socket.emit('message', { text: `Result: ${result.toUpperCase()}. YOU WON +${amt} ODZ!`, type: 'success' });
            socket.emit('play_sound', 'success');
        } else {
            p.balance -= amt;
            socket.emit('message', { text: `Result: ${result.toUpperCase()}. You lost ${amt} ODZ.`, type: 'error' });
            socket.emit('play_sound', 'error');
        }
        await p.save();
        socket.emit('player_data', p);
    } catch(e) { socket.emit('message', { text: 'Gamble failed.', type: 'error' }); }
  });

  socket.on('shop', () => {
      let list = "=== BLACK MARKET ===\n";
      for (const [id, item] of Object.entries(SHOP)) {
          list += `[${id.padEnd(12)}] ${item.price} ODZ - ${item.desc}\n`;
      }
      socket.emit('message', { text: list, type: 'info' });
  });

  socket.on('buy', async (id) => {
    if (!user) return;
    try {
        let p = await Player.findOne({ username: user });
        const item = SHOP[id];
        if (!item) return socket.emit('message', { text: 'Item unknown.', type: 'error' });
        if (p.balance < item.price) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
        
        p.balance -= item.price;
        
        if(item.type === 'upgrade') {
            p[item.stat] = item.val;
            socket.emit('message', { text: `System Upgraded: ${item.stat.toUpperCase()}`, type: 'success' });
        } else if(item.type === 'bot') {
            p.botnet++;
            socket.emit('message', { text: `Botnet Node Added.`, type: 'success' });
        } else if(item.type === 'skin') {
            if(!p.inventory.includes(id)) p.inventory.push(id);
            socket.emit('message', { text: `Theme Acquired: ${item.val}`, type: 'success' });
        } else {
            p.inventory.push(id);
            socket.emit('message', { text: `Item Added: ${id}`, type: 'success' });
        }
        
        await p.save();
        socket.emit('player_data', p);
    } catch(e) { socket.emit('message', { text: 'Transaction failed.', type: 'error' }); }
  });

  // --- SYSTEM & FILES (RESTORED) ---
  socket.on('files', async () => {
      if(!user) return;
      const p = await Player.findOne({ username: user });
      const list = p.files && p.files.length > 0 ? p.files.join('\n') : 'No files found.';
      socket.emit('message', { text: `DIRECTORY LISTING:\n${list}`, type: 'info' });
  });

  socket.on('read', async (filename) => {
      if(!user) return;
      // Basic check for default files
      if(FILE_CONTENTS[filename]) {
          socket.emit('message', { text: `OPENING ${filename}...\n\n${FILE_CONTENTS[filename]}`, type: 'info' });
      } else {
          // In a real game, you'd check p.files, but for now we just check the constant
          socket.emit('message', { text: 'File corrupted or access denied.', type: 'error' });
      }
  });

  // --- SOCIAL ---
  socket.on('global_chat', (msg) => {
    if(!user) return;
    io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
  });

  socket.on('mail_send', async ({ recipient, body }) => {
    if(!user) return;
    const sent = await sendMail(recipient, user, "Encrypted Msg", body);
    if(sent) socket.emit('message', { text: 'Message Sent.', type: 'success' });
    else socket.emit('message', { text: 'Recipient not found.', type: 'error' });
  });

  socket.on('mail_check', async () => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    if(!p.inbox || p.inbox.length === 0) return socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
    let list = "--- SECURE INBOX ---\n";
    p.inbox.forEach((m, i) => list += `[${i+1}] ${m.from}: ${m.subject} ${m.read ? '' : '(NEW)'}\n`);
    socket.emit('message', { text: list, type: 'info', instant: true });
  });

  socket.on('mail_read', async (id) => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    const idx = parseInt(id) - 1;
    if(!p.inbox[idx]) return socket.emit('message', { text: 'Invalid ID.', type: 'error' });
    const m = p.inbox[idx];
    m.read = true;
    await p.save();
    socket.emit('message', { text: `FROM: ${m.from}\nMSG: ${m.body}`, type: 'info' });
  });

  // --- HACKING ---
  socket.on('hack_init', async (target) => {
    if (!user || target === user) return;
    const t = await Player.findOne({ username: target });
    if (!t) return socket.emit('message', { text: 'Target offline.', type: 'error' });
    
    // Honeypot Check
    if(t.activeHoneypot) {
      let p = await Player.findOne({ username: user });
      p.balance = Math.max(0, p.balance - 100);
      t.activeHoneypot = false;
      await p.save(); await t.save();
      socket.emit('player_data', p);
      return socket.emit('message', { text: 'HONEYPOT TRIGGERED! You were traced and fined 100 ODZ.', type: 'error' });
    }

    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // 4 Digits
    ACTIVE_HACKS[user] = { target, pin, attempts: 5 };
    socket.emit('message', { text: `CONNECTION ESTABLISHED: ${target}\nFIREWALL: ACTIVE\nPIN REQUIRED: ****`, type: 'special' });
  });

  socket.on('guess', async (pin) => {
    const sess = ACTIVE_HACKS[user];
    if (!sess) return socket.emit('message', { text: 'No active hack.', type: 'error' });
    
    if (pin === sess.pin) {
      delete ACTIVE_HACKS[user];
      let p = await Player.findOne({ username: user });
      let t = await Player.findOne({ username: sess.target });
      
      const steal = Math.floor(t.balance * 0.2);
      t.balance -= steal;
      p.balance += steal;

      // Claim Bounty
      if(t.bounty > 0) {
          p.balance += t.bounty;
          socket.emit('message', { text: `BOUNTY COLLECTED: +${t.bounty} ODZ`, type: 'special' });
          t.bounty = 0;
      }

      await p.save(); await t.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `ACCESS GRANTED. Stole ${steal} ODZ.`, type: 'success' });
      socket.emit('play_sound', 'success');
    } else {
      sess.attempts--;
      if(sess.attempts <= 0) { 
          delete ACTIVE_HACKS[user]; 
          socket.emit('message', { text: 'SYSTEM LOCKOUT. Connection severed.', type: 'error' }); 
      } else {
          const hint = pin < sess.pin ? 'Higher' : 'Lower';
          socket.emit('message', { text: `ACCESS DENIED. Signal: ${hint}. Tries: ${sess.attempts}`, type: 'warning' });
      }
    }
  });

  socket.on('set_bounty', async ({ target, amount }) => {
      if(!user) return;
      const amt = parseInt(amount);
      if(isNaN(amt) || amt <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
      
      let p = await Player.findOne({ username: user });
      if(p.balance < amt) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
      
      let t = await Player.findOne({ username: target });
      if(!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });

      p.balance -= amt;
      t.bounty += amt;
      await p.save(); await t.save();
      socket.emit('player_data', p);
      io.emit('message', { text: `BOUNTY ALERT: ${user} placed ${amt} ODZ on ${target}!`, type: 'special' });
  });

  // --- CAMPAIGN (Server Hack) ---
  socket.on('server_hack_start', () => {
    ADVENTURE_SESSIONS[socket.id] = { node: 'lobby' };
    socket.emit('message', { text: `CONNECTED TO CORP_NET.\n${SERVER_MAP['lobby'].desc}`, type: 'special' });
  });

  socket.on('navigate', (dirInput) => {
    const sess = ADVENTURE_SESSIONS[socket.id];
    if (!sess) return;
    const dir = DIR_MAP[dirInput] || dirInput; 
    
    const current = SERVER_MAP[sess.node];
    const nextKey = current.exits[dir];
    
    if (!nextKey) return socket.emit('message', { text: 'Path blocked or does not exist.', type: 'error' });
    
    const nextNode = SERVER_MAP[nextKey];
    
    // Lock Logic
    if (nextNode.locked) {
        // Simplified: check if user owns tool (requires fetch)
        // For now, allow passage if network > 1 or warn
        socket.emit('message', { text: `FIREWALL BLOCKS PATH. Req: ${nextNode.req}`, type: 'warning' });
        // In a real fix, check inventory here.
        // Allowing bypass for testing:
        // sess.node = nextKey;
        return;
    }

    sess.node = nextKey;
    socket.emit('message', { text: `> ${dir.toUpperCase()}\n${nextNode.desc}`, type: 'info' });
    
    if(nextNode.isGoal) {
        socket.emit('message', { text: 'DOWNLOADING DATA... +500 XP +2000 ODZ', type: 'success' });
        delete ADVENTURE_SESSIONS[socket.id];
        // Give rewards logic here
    }
  });

  socket.on('set_theme', async (t) => {
      if(!user) return;
      let p = await Player.findOne({ username: user });
      p.theme = t;
      await p.save();
      socket.emit('player_data', p);
  });

  socket.on('disconnect', () => {
    delete ADVENTURE_SESSIONS[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`>> SERVER ONLINE on port ${PORT}`));
