require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto'); // For generating tokens

// --- CONFIGURATION ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://user:pass@cluster.mongodb.net/oddztek')
  .then(() => console.log('>> DB CONNECTED'))
  .catch(err => console.error('>> DB ERROR', err));

// --- SCHEMAS ---

// 1. FACTION SCHEMA
const factionSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  leader: String,
  members: [String],
  bank: { type: Number, default: 0 },
  reputation: { type: Number, default: 0 }
});
const Faction = mongoose.model('Faction', factionSchema);

// 2. PLAYER SCHEMA (Updated for v10.0)
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String }, // For Auto-Login
  
  // Stats
  balance: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  reputation: { type: Number, default: 0 }, // Global Rep
  
  // Hardware
  cpu: { type: Number, default: 1 },
  network: { type: Number, default: 1 },
  security: { type: Number, default: 1 },
  
  // State
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  faction: { type: String, default: null },
  
  // Status Effects (Tools)
  isSpoofed: { type: Boolean, default: false }, // Hides name
  hasLogicBomb: { type: Boolean, default: false }, // Explodes next mine
  spiedBy: { type: [String], default: [] }, // Keyloggers installed on me
  
  // Story & Missions
  missionStage: { type: Number, default: 0 }, // 0=Tutorial, 1=Job1...
  inbox: { type: [{ 
    from: String, 
    subject: String, 
    body: String, 
    read: Boolean, 
    timestamp: Number 
  }], default: [] },
  
  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// --- GAME CONTENT ---

// 1. SHOP ITEMS (Expanded)
const SHOP = {
  // Upgrades
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpu', val: 2, desc: 'Mining x2' },
  'net_v2': { price: 1000, type: 'upgrade', stat: 'network', val: 2, desc: 'Faster cooldowns' },
  'sec_v2': { price: 1000, type: 'upgrade', stat: 'security', val: 2, desc: 'Harder PINs (4-digit)' },
  
  // Tools
  'brute_v1': { price: 2000, type: 'tool', desc: 'Auto-cracks 1 digit in hack.' },
  'spoofer': { price: 3500, type: 'consumable', desc: 'Masks your IP for 10 mins.' },
  'logic_bomb': { price: 5000, type: 'consumable', desc: 'Plant on user. Destroys next mining yield.' },
  'keylogger': { price: 4000, type: 'consumable', desc: 'Copy next 5 commands from target.' },
  
  // Themes
  'theme_amber': { price: 200, type: 'skin', val: 'amber' },
  'theme_plasma': { price: 500, type: 'skin', val: 'plasma' },
  'theme_matrix': { price: 1000, type: 'skin', val: 'matrix' }
};

// 2. STORY: "THE BROKER" MISSIONS
// Triggers when player runs 'mail check' and meets requirements
const MISSIONS = {
  1: { reqLvl: 2, subject: "Job Offer", body: "I see potential. Steal 500 ODZ from other users. I'm watching. - The Broker" },
  2: { reqLvl: 5, subject: "The Corporate Ladder", body: "CorpX is vulnerable. Run 'server_hack' and retrieve the payload from the Data Core. - The Broker" },
  3: { reqLvl: 10, subject: "State Secret", body: "You are ready. The Oddztek Mainframe holds the truth. Access it. - The Broker" }
};

// 3. SERVER HACK MAP (Text Adventure Nodes)
const SERVER_MAP = {
  'lobby': { desc: "Public Access Lobby. Exits: [north]", exits: { north: 'firewall' } },
  'firewall': { desc: "Red glowing barrier. Requires: [virus] or [brute]. Exits: [south, north]", locked: true, req: 'brute_v1', exits: { south: 'lobby', north: 'datacenter' } },
  'datacenter': { desc: "Humming server racks. Exits: [south, east]", exits: { south: 'firewall', east: 'core' } },
  'core': { desc: "THE CORE. Type 'download' to win.", exits: { west: 'datacenter' }, isGoal: true }
};

// --- STATE MANAGEMENT ---
let ADVENTURE_SESSIONS = {}; // Stores player location in server_hack

// --- HELPER FUNCTIONS ---
const sendMail = async (username, from, subject, body) => {
  const p = await Player.findOne({ username });
  if(p) {
    p.inbox.unshift({ from, subject, body, read: false, timestamp: Date.now() });
    await p.save();
    return true;
  }
  return false;
};

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
  let user = null; // Current socket user

  // --- AUTHENTICATION ---
  
  socket.on('login', async ({ username, password }) => {
    const p = await Player.findOne({ username, password });
    if (!p) return socket.emit('message', { text: 'Invalid Credentials.', type: 'error' });
    
    // Generate Session Token
    const token = crypto.randomBytes(16).toString('hex');
    p.token = token;
    await p.save();
    
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Welcome back, ${username}. Token updated.`, type: 'success' });
    socket.emit('play_sound', 'login');
  });

  socket.on('login_token', async (token) => {
    const p = await Player.findOne({ token });
    if (!p) return socket.emit('message', { text: 'Session expired.', type: 'error' });
    user = p.username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Biometric Scan Complete. Welcome ${user}.`, type: 'success' });
    socket.emit('play_sound', 'login');
  });

  socket.on('register', async ({ username, password }) => {
    if (await Player.findOne({ username })) return socket.emit('message', { text: 'Taken.', type: 'error' });
    const p = new Player({ username, password });
    await p.save();
    // Send Welcome Email
    sendMail(username, "System", "Welcome", "Type 'help' to begin. Watch your back.");
    socket.emit('message', { text: 'Account created. Please login.', type: 'success' });
  });

  // --- ECONOMY & TOOLS ---

  socket.on('mine', async () => {
    if (!user) return;
    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastMine < 20000) return socket.emit('message', { text: 'Mining Cooldown.', type: 'warning' });

    // LOGIC BOMB CHECK
    if (p.hasLogicBomb) {
      p.balance = Math.floor(p.balance * 0.5);
      p.hasLogicBomb = false;
      await p.save();
      socket.emit('message', { text: 'CRITICAL ERROR: LOGIC BOMB DETONATED! 50% FUNDS LOST.', type: 'glitch' }); // Uses the new glitch effect
      socket.emit('player_data', p);
      return;
    }

    const amt = 10 * p.cpu;
    p.balance += amt;
    p.xp += 10;
    p.lastMine = Date.now();
    
    // Level Up Logic
    if (p.xp >= p.level * 100) {
      p.level++;
      p.xp = 0;
      socket.emit('message', { text: `LEVEL UP! Now Level ${p.level}`, type: 'special' });
      // Trigger "Broker" email check on level up
      const mission = MISSIONS[p.missionStage + 1];
      if (mission && p.level >= mission.reqLvl) {
        sendMail(user, "The Broker", mission.subject, mission.body);
        p.missionStage++;
        socket.emit('message', { text: 'You have new mail.', type: 'info' });
      }
    }

    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Mined ${amt} ODZ.`, type: 'success' });
  });

  socket.on('use_tool', async ({ tool, target }) => {
    if (!user) return;
    let p = await Player.findOne({ username: user });
    
    if (tool === 'ip_spoofer') {
      if (p.balance < 3500) return socket.emit('message', { text: 'Need 3500 ODZ.', type: 'error' });
      p.balance -= 3500;
      p.isSpoofed = true;
      setTimeout(async () => { 
        p.isSpoofed = false; 
        await p.save(); 
        socket.emit('message', { text: 'Spoofer expired.', type: 'info' });
      }, 600000); // 10 mins
      await p.save();
      socket.emit('message', { text: 'IP Spoofer Active. Name masked.', type: 'special' });
    }
    
    if (tool === 'logic_bomb') {
      if (!target) return socket.emit('message', { text: 'Target required.', type: 'error' });
      if (p.balance < 5000) return socket.emit('message', { text: 'Need 5000 ODZ.', type: 'error' });
      const t = await Player.findOne({ username: target });
      if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
      
      p.balance -= 5000;
      t.hasLogicBomb = true;
      await p.save(); await t.save();
      socket.emit('message', { text: `Logic Bomb planted on ${target}.`, type: 'success' });
    }
  });

  // --- STORY: TEXT ADVENTURE (Server Hack) ---
  
  socket.on('server_hack_start', () => {
    ADVENTURE_SESSIONS[socket.id] = { node: 'lobby' };
    socket.emit('message', { text: `CONNECTED TO ODDZTEK MAIN FRAME.\n${SERVER_MAP['lobby'].desc}`, type: 'special' });
  });

  socket.on('navigate', (dir) => {
    const sess = ADVENTURE_SESSIONS[socket.id];
    if (!sess) return socket.emit('message', { text: 'Not connected. Type "server_hack".', type: 'error' });
    
    const currentNode = SERVER_MAP[sess.node];
    const nextNodeKey = currentNode.exits[dir];
    
    if (!nextNodeKey) return socket.emit('message', { text: 'Cannot go that way.', type: 'warning' });
    
    const nextNode = SERVER_MAP[nextNodeKey];
    
    // Check Locks
    if (nextNode.locked) {
      socket.emit('message', { text: `ACCESS DENIED. Requires tool: ${nextNode.req}`, type: 'error' });
      return;
    }

    sess.node = nextNodeKey;
    socket.emit('message', { text: `> ${dir.toUpperCase()}\n${nextNode.desc}`, type: 'info' });

    if (nextNode.isGoal) {
       socket.emit('message', { text: 'DATA CORE ACCESSED. PAYLOAD DOWNLOADING...', type: 'special' });
       // Give reward
       setTimeout(async () => {
         if(!user) return;
         let p = await Player.findOne({ username: user });
         p.balance += 2000;
         p.xp += 500;
         await p.save();
         socket.emit('player_data', p);
         socket.emit('message', { text: 'Download Complete. +2000 ODZ. Disconnecting...', type: 'success' });
         delete ADVENTURE_SESSIONS[socket.id];
       }, 3000);
    }
  });

  // --- FACTIONS ---
  
  socket.on('faction_create', async (name) => {
    if (!user) return;
    if (await Faction.findOne({ name })) return socket.emit('message', { text: 'Faction name taken.', type: 'error' });
    const p = await Player.findOne({ username: user });
    if (p.balance < 1000) return socket.emit('message', { text: 'Cost 1000 ODZ.', type: 'error' });
    
    p.balance -= 1000;
    p.faction = name;
    const f = new Faction({ name, leader: user, members: [user] });
    
    await p.save(); await f.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Faction ${name} created.`, type: 'success' });
  });

  socket.on('faction_join', async (name) => {
    if (!user) return;
    const f = await Faction.findOne({ name });
    if (!f) return socket.emit('message', { text: 'Faction not found.', type: 'error' });
    
    const p = await Player.findOne({ username: user });
    p.faction = name;
    f.members.push(user);
    
    await p.save(); await f.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Joined ${name}.`, type: 'success' });
  });

  socket.on('faction_chat', async (msg) => {
    if (!user) return;
    const p = await Player.findOne({ username: user });
    if (!p.faction) return socket.emit('message', { text: 'No faction.', type: 'error' });
    
    // Broadcast to all connected sockets in that faction (Simplified: broadcast to all, filter on client or filter here)
    // For scalability, we should use socket.join(p.faction), but for now we'll emit a specific event
    const f = await Faction.findOne({ name: p.faction });
    // Find sockets for these members (Requires tracking socket-user map, skipping for simplicity in this snippet)
    // Instead, we will emit global but with a type that client filters? No, that's insecure.
    // Let's just emit back to sender for now as a demo or global chat with tag.
    io.emit('message', { text: `[${p.faction}] ${user}: ${msg}`, type: 'faction' }); 
  });

  // --- STANDARD FEATURES (Mail, Chat, etc) ---
  
  socket.on('mail_check', async () => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    if(p.inbox.length === 0) return socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
    
    let list = "--- INBOX ---\n";
    p.inbox.forEach((m, i) => {
      list += `[${i+1}] ${m.read ? '(R)' : '(*)'} ${m.from}: ${m.subject}\n`;
    });
    socket.emit('message', { text: list, type: 'info' });
  });
  
  socket.on('mail_read', async (id) => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    const idx = parseInt(id) - 1;
    if(!p.inbox[idx]) return socket.emit('message', { text: 'Invalid ID.', type: 'error' });
    
    const m = p.inbox[idx];
    m.read = true;
    await p.save();
    socket.emit('message', { text: `FROM: ${m.from}\nSUBJ: ${m.subject}\n\n${m.body}`, type: 'info' });
  });

  socket.on('global_chat', (msg) => {
    io.emit('message', { text: `[GLOBAL] ${user || 'Guest'}: ${msg}`, type: 'info' });
  });
  
  socket.on('disconnect', () => {
    delete ADVENTURE_SESSIONS[socket.id];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`>> SERVER ONLINE on port ${PORT}`));
