require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://user:pass@cluster.mongodb.net/oddztek')
  .then(() => console.log('>> DB CONNECTED'))
  .catch(err => console.error('>> DB ERROR', err));

// --- SCHEMAS ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String },
  balance: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  // Hardware & Stats
  cpu: { type: Number, default: 1 },
  network: { type: Number, default: 1 },
  security: { type: Number, default: 1 },
  botnet: { type: Number, default: 0 }, // Passive Income Bots
  bounty: { type: Number, default: 0 }, // Head price
  // State
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  faction: { type: String, default: null },
  inbox: { type: [{ from: String, subject: String, body: String, read: Boolean, timestamp: Number }], default: [] },
  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  // Tools
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

// --- CONFIG ---
const SHOP = {
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpu', val: 2, desc: 'Mining x2' },
  'bot_v1': { price: 2000, type: 'bot', desc: 'Passive Income (+10 ODZ/min)' },
  'net_v2': { price: 1000, type: 'upgrade', stat: 'network', val: 2, desc: 'Faster cooldowns' },
  'sec_v2': { price: 1000, type: 'upgrade', stat: 'security', val: 2, desc: 'Harder PINs' },
  'brute_v1': { price: 2000, type: 'tool', desc: 'Auto-crack 1 digit' },
  'spoofer': { price: 3500, type: 'consumable', desc: 'Mask IP for 10m' },
  'logic_bomb': { price: 5000, type: 'consumable', desc: 'Destroy target mining' },
  'honeypot': { price: 500, type: 'consumable', desc: 'Trap hackers' },
  'theme_matrix': { price: 1000, type: 'skin', val: 'matrix' }
};

const SERVER_MAP = {
  'lobby': { desc: "Public Access Lobby. Exits: [north]", exits: { north: 'firewall' } },
  'firewall': { desc: "Red glowing barrier. Exits: [south, north]. Req: [brute_v1]", locked: true, req: 'brute_v1', exits: { south: 'lobby', north: 'core' } },
  'core': { desc: "THE CORE. Type 'nav w' to exit or wait for download.", exits: { south: 'firewall' }, isGoal: true }
};

const DIR_MAP = { n: 'north', s: 'south', e: 'east', w: 'west' };

let ACTIVE_HACKS = {}; 
let ADVENTURE_SESSIONS = {};

// --- BOTNET LOOP (Passive Income) ---
setInterval(async () => {
  const playersWithBots = await Player.find({ botnet: { $gt: 0 } });
  for (const p of playersWithBots) {
    p.balance += (p.botnet * 10);
    await p.save();
  }
}, 60000); // Every minute

// --- SOCKET ---
io.on('connection', (socket) => {
  let user = null;

  const sendMail = async (targetUser, from, subject, body) => {
    const p = await Player.findOne({ username: targetUser });
    if(p) {
      p.inbox.unshift({ from, subject, body, read: false, timestamp: Date.now() });
      await p.save();
      // If target is online, notify them? (Optional optimization)
      return true;
    }
    return false;
  };

  socket.on('register', async ({ username, password }) => {
    if (await Player.findOne({ username })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
    const p = new Player({ username, password });
    await p.save();
    sendMail(username, "The Broker", "Job Offer", "Get to Level 2. I have work for you.");
    socket.emit('message', { text: 'Account created.', type: 'success' });
  });

  socket.on('login', async ({ username, password }) => {
    const p = await Player.findOne({ username, password });
    if (!p) return socket.emit('message', { text: 'Invalid.', type: 'error' });
    p.token = crypto.randomBytes(16).toString('hex');
    await p.save();
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Welcome, ${username}.`, type: 'success' });
    socket.emit('play_sound', 'login');
  });

  socket.on('login_token', async (token) => {
    const p = await Player.findOne({ token });
    if (!p) return socket.emit('message', { text: 'Session expired.', type: 'error' });
    user = p.username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Welcome back, ${user}.`, type: 'success' });
  });

  // --- FEATURES ---

  socket.on('global_chat', (msg) => {
    if(!user) return;
    io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
  });

  socket.on('mail_send', async ({ recipient, body }) => {
    if(!user) return;
    const sent = await sendMail(recipient, user, "Message", body);
    if(sent) socket.emit('message', { text: 'Mail sent.', type: 'success' });
    else socket.emit('message', { text: 'User not found.', type: 'error' });
  });

  socket.on('mail_check', async () => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    if(p.inbox.length === 0) return socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
    let list = "--- INBOX ---\n";
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

  socket.on('mine', async () => {
    if (!user) return;
    let p = await Player.findOne({ username: user });
    // Logic Bomb Check
    if (p.hasLogicBomb) {
      p.balance = Math.floor(p.balance / 2);
      p.hasLogicBomb = false;
      await p.save();
      return socket.emit('message', { text: 'CRITICAL FAILURE: LOGIC BOMB DETONATED.', type: 'error' });
    }
    if (Date.now() - p.lastMine < 5000) return socket.emit('message', { text: 'Cooling down...', type: 'warning' });
    
    const gain = 10 * p.cpu;
    p.balance += gain;
    p.xp += 10;
    p.lastMine = Date.now();
    
    if(p.xp >= p.level * 100) { p.level++; p.xp=0; socket.emit('message', { text: 'LEVEL UP!', type: 'special' }); }
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Mined +${gain} ODZ`, type: 'success' });
  });

  socket.on('buy', async (id) => {
    if (!user) return;
    let p = await Player.findOne({ username: user });
    const item = SHOP[id];
    if (!item || p.balance < item.price) return socket.emit('message', { text: 'Cannot buy.', type: 'error' });
    
    p.balance -= item.price;
    if(item.type === 'upgrade') p[item.stat] = item.val;
    else if(item.type === 'bot') p.botnet++;
    else p.inventory.push(id);
    
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Bought ${id}.`, type: 'success' });
  });

  socket.on('set_bounty', async ({ target, amount }) => {
    if (!user) return;
    const amt = parseInt(amount);
    let p = await Player.findOne({ username: user });
    if(p.balance < amt) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    let t = await Player.findOne({ username: target });
    if(!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });

    p.balance -= amt;
    t.bounty += amt;
    await p.save(); await t.save();
    io.emit('message', { text: `BOUNTY: ${user} set ${amt} ODZ on ${target}!`, type: 'special' });
  });

  // --- HACKING LOOP ---
  socket.on('hack_init', async (target) => {
    if (!user || target === user) return;
    const t = await Player.findOne({ username: target });
    if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
    
    if(t.activeHoneypot) {
      let p = await Player.findOne({ username: user });
      p.balance -= 100;
      t.activeHoneypot = false;
      await p.save(); await t.save();
      return socket.emit('message', { text: 'HONEYPOT TRIPPED! Lost 100 ODZ.', type: 'error' });
    }

    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit
    ACTIVE_HACKS[user] = { target, pin, attempts: 5 };
    socket.emit('message', { text: `Breaching ${target}...\nPIN: ****\nType 'guess [pin]'`, type: 'special' });
  });

  socket.on('guess', async (pin) => {
    const sess = ACTIVE_HACKS[user];
    if (!sess) return;
    if (pin === sess.pin) {
      delete ACTIVE_HACKS[user];
      let p = await Player.findOne({ username: user });
      let t = await Player.findOne({ username: sess.target });
      const steal = Math.floor(t.balance * 0.2);
      t.balance -= steal;
      p.balance += steal;
      
      // Claim Bounty
      if (t.bounty > 0) {
        p.balance += t.bounty;
        socket.emit('message', { text: `BOUNTY CLAIMED: +${t.bounty} ODZ`, type: 'special' });
        t.bounty = 0;
      }

      await p.save(); await t.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `HACK SUCCESSFUL. Stole ${steal} ODZ.`, type: 'success' });
    } else {
      sess.attempts--;
      if(sess.attempts <= 0) { delete ACTIVE_HACKS[user]; socket.emit('message', { text: 'Lockout.', type: 'error' }); return; }
      const hint = pin < sess.pin ? 'Higher' : 'Lower';
      socket.emit('message', { text: `Incorrect (${hint}). ${sess.attempts} tries left.`, type: 'warning' });
    }
  });

  // --- SERVER MISSION ---
  socket.on('server_hack_start', () => {
    ADVENTURE_SESSIONS[socket.id] = { node: 'lobby' };
    socket.emit('message', { text: `MAIN FRAME: ${SERVER_MAP['lobby'].desc}`, type: 'special' });
  });

  socket.on('navigate', (dirInput) => {
    const sess = ADVENTURE_SESSIONS[socket.id];
    if (!sess) return;
    const dir = DIR_MAP[dirInput] || dirInput; // Handle 'n' -> 'north'
    
    const current = SERVER_MAP[sess.node];
    const nextKey = current.exits[dir];
    if (!nextKey) return socket.emit('message', { text: 'Cannot go that way.', type: 'error' });
    
    // Check Locks
    if (SERVER_MAP[nextKey].locked) {
       // Check if user has tool in inventory (requires fetch)
       // Simplified for speed:
       socket.emit('message', { text: 'Firewall blocks you. (Needs brute_v1)', type: 'error' });
       return; 
    }

    sess.node = nextKey;
    const nextNode = SERVER_MAP[nextKey];
    socket.emit('message', { text: `> ${dir}\n${nextNode.desc}`, type: 'info' });
    
    if(nextNode.isGoal) {
      socket.emit('message', { text: 'PAYLOAD SECURED. +1000 ODZ', type: 'success' });
      // Award money logic here
      delete ADVENTURE_SESSIONS[socket.id];
    }
  });
  
  // --- UTILS ---
  socket.on('ping', (cb) => cb && cb());
  socket.on('disconnect', () => delete ADVENTURE_SESSIONS[socket.id]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`>> SERVER ONLINE on port ${PORT}`));
