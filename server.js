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

// --- SCHEMA ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String },
  balance: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  cpu: { type: Number, default: 1 },
  network: { type: Number, default: 1 },
  botnet: { type: Number, default: 0 },
  bounty: { type: Number, default: 0 },
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  faction: { type: String, default: null },
  files: { type: [String], default: ['readme.txt', 'sys_log.dat'] },
  // Important: Inbox Schema handles optional fields
  inbox: { type: [{ from: String, subject: String, body: String, read: Boolean, timestamp: Number }], default: [] },
  lastMine: { type: Number, default: 0 },
  activeHoneypot: { type: Boolean, default: false },
  hasLogicBomb: { type: Boolean, default: false }
});
const Player = mongoose.model('Player', playerSchema);

const factionSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  leader: String,
  members: [String],
});
const Faction = mongoose.model('Faction', factionSchema);

// --- GAME DATA ---
const SHOP = {
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpu', val: 2, desc: 'Mining Yield x2' },
  'net_v2': { price: 1000, type: 'upgrade', stat: 'network', val: 2, desc: 'Faster Cooldowns' },
  'bot_node': { price: 2500, type: 'bot', desc: 'Passive Income (+20 ODZ/min)' },
  'brute_v1': { price: 2000, type: 'tool', desc: 'Auto-crack 1 digit' },
  'spoofer': { price: 3500, type: 'consumable', desc: 'Mask IP for 10m' },
  'logic_bomb': { price: 5000, type: 'consumable', desc: 'Destroy target mine' },
  'honeypot': { price: 500, type: 'consumable', desc: 'Trap hackers' },
  'theme_amber': { price: 200, type: 'skin', val: 'amber' },
  'theme_plasma': { price: 500, type: 'skin', val: 'plasma' },
  'theme_matrix': { price: 1000, type: 'skin', val: 'matrix' }
};

const FILE_CONTENTS = {
  'readme.txt': "Oddztek v10.3\nSystem Stable.\nDo not paste code in terminal.",
  'sys_log.dat': "Connection established...",
};

const SERVER_MAP = {
  'lobby': { desc: "Lobby. Exits: [north]", exits: { north: 'firewall' } },
  'firewall': { desc: "Firewall (Locked). Exits: [south, north]", locked: true, req: 'brute_v1', exits: { south: 'lobby', north: 'core' } },
  'core': { desc: "CORE. Exits: [south].", exits: { south: 'firewall' }, isGoal: true }
};
const DIR_MAP = { n: 'north', s: 'south', e: 'east', w: 'west' };

let ACTIVE_HACKS = {}; 
let ADVENTURE_SESSIONS = {};

// --- PASSIVE INCOME ---
setInterval(async () => {
  const players = await Player.find({ botnet: { $gt: 0 } });
  for (const p of players) { p.balance += p.botnet * 20; await p.save(); }
}, 60000);

// --- SOCKET ---
io.on('connection', (socket) => {
  let user = null;

  const sendMail = async (target, from, subject, body) => {
    try {
      const p = await Player.findOne({ username: target });
      if(p) {
        p.inbox.unshift({ from, subject, body, read: false, timestamp: Date.now() });
        await p.save();
        return true;
      }
      return false;
    } catch(e) { return false; }
  };

  // Auth
  socket.on('register', async ({ username, password }) => {
    if (await Player.findOne({ username })) return socket.emit('message', { text: 'Taken.', type: 'error' });
    const p = new Player({ username, password });
    await p.save();
    sendMail(username, "System", "Welcome", "Type 'help' to begin.");
    socket.emit('message', { text: 'Registered.', type: 'success' });
  });

  socket.on('login', async ({ username, password }) => {
    const p = await Player.findOne({ username, password });
    if (!p) return socket.emit('message', { text: 'Invalid.', type: 'error' });
    p.token = crypto.randomBytes(16).toString('hex');
    await p.save();
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', { text: `Welcome ${username}.`, type: 'success' });
    socket.emit('play_sound', 'login');
  });

  socket.on('login_token', async (token) => {
    const p = await Player.findOne({ token });
    if(p) {
       user = p.username;
       socket.emit('player_data', p);
       socket.emit('message', { text: `Welcome back ${user}.`, type: 'success' });
    }
  });

  // Utils
  socket.on('ping', (start) => socket.emit('pong', start)); // FIXED PING

  // Economy
  socket.on('mine', async () => {
    if(!user) return;
    let p = await Player.findOne({ username: user });
    if(p.hasLogicBomb) {
       p.balance = Math.floor(p.balance/2); p.hasLogicBomb = false; await p.save();
       return socket.emit('message', { text: 'LOGIC BOMB EXPLODED!', type: 'error' });
    }
    if(Date.now() - p.lastMine < 5000) return socket.emit('message', { text: 'Cooldown.', type: 'warning' });
    
    const gain = 10 * p.cpu;
    p.balance += gain; p.xp += 10; p.lastMine = Date.now();
    if(p.xp >= p.level * 100) { p.level++; p.xp=0; socket.emit('message', { text: 'LEVEL UP!', type: 'special' }); }
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Mined +${gain}`, type: 'success' });
  });

  socket.on('coinflip', async ({ side, amount }) => {
     if(!user) return;
     const amt = parseInt(amount);
     let p = await Player.findOne({ username: user });
     if(p.balance < amt) return socket.emit('message', { text: 'No funds.', type: 'error' });
     
     const res = Math.random() > 0.5 ? 'heads' : 'tails';
     if(side === res) { p.balance += amt; socket.emit('message', { text: `WIN! +${amt}`, type: 'success' }); socket.emit('play_sound', 'success'); }
     else { p.balance -= amt; socket.emit('message', { text: `LOST ${amt}`, type: 'error' }); socket.emit('play_sound', 'error'); }
     await p.save();
     socket.emit('player_data', p);
  });

  // Shop & Files
  socket.on('shop', () => {
     let list = "=== MARKET ===\n";
     for(const [k,v] of Object.entries(SHOP)) list += `[${k}] ${v.price} - ${v.desc}\n`;
     socket.emit('message', { text: list, type: 'info' });
  });

  socket.on('buy', async (id) => {
     if(!user) return;
     let p = await Player.findOne({ username: user });
     const i = SHOP[id];
     if(!i || p.balance < i.price) return socket.emit('message', { text: 'Cannot buy.', type: 'error' });
     p.balance -= i.price;
     if(i.type === 'upgrade') p[i.stat] = i.val;
     else if(i.type === 'bot') p.botnet++;
     else p.inventory.push(id);
     await p.save();
     socket.emit('player_data', p);
     socket.emit('message', { text: `Bought ${id}`, type: 'success' });
  });

  socket.on('files', async () => {
     if(!user) return;
     const p = await Player.findOne({ username: user });
     socket.emit('message', { text: `FILES:\n${p.files.join('\n')}`, type: 'info' });
  });
  
  socket.on('read', (f) => {
     if(FILE_CONTENTS[f]) socket.emit('message', { text: FILE_CONTENTS[f], type: 'info' });
     else socket.emit('message', { text: 'File not found.', type: 'error' });
  });

  // Mail
  socket.on('mail_send', async ({ recipient, body }) => {
     if(!user) return;
     const sent = await sendMail(recipient, user, "Encrypted", body);
     if(sent) socket.emit('message', { text: 'Sent.', type: 'success' });
     else socket.emit('message', { text: 'User not found.', type: 'error' });
  });

  socket.on('mail_check', async () => {
     if(!user) return;
     const p = await Player.findOne({ username: user });
     let list = "INBOX:\n";
     // FIX: Handle undefined subjects from old data
     p.inbox.forEach((m,i) => list += `[${i+1}] ${m.from}: ${m.subject || 'No Subject'} ${m.read ? '' : '(NEW)'}\n`);
     socket.emit('message', { text: list, type: 'info' });
  });
  
  socket.on('mail_read', async (id) => {
     if(!user) return;
     const p = await Player.findOne({ username: user });
     const m = p.inbox[id-1];
     if(!m) return socket.emit('message', { text: 'Invalid ID', type: 'error' });
     m.read = true; await p.save();
     // FIX: Handle undefined body
     socket.emit('message', { text: `MSG:\n${m.body || m.msg || 'Empty'}`, type: 'info' });
  });
  
  socket.on('global_chat', (m) => io.emit('message', { text: `[CHAT] ${user}: ${m}`, type: 'info' }));

  // Adventure
  socket.on('server_hack_start', () => {
    ADVENTURE_SESSIONS[socket.id] = { node: 'lobby' };
    socket.emit('message', { text: `CONNECTED.\n${SERVER_MAP['lobby'].desc}`, type: 'special' });
  });
  
  socket.on('navigate', (d) => {
     const sess = ADVENTURE_SESSIONS[socket.id];
     if(!sess) return;
     const dir = DIR_MAP[d] || d;
     const curr = SERVER_MAP[sess.node];
     const next = curr.exits[dir];
     if(!next) return socket.emit('message', { text: 'Blocked.', type: 'error' });
     
     if(SERVER_MAP[next].locked) return socket.emit('message', { text: `LOCKED. Req: ${SERVER_MAP[next].req}`, type: 'warning' });
     
     sess.node = next;
     socket.emit('message', { text: `> ${dir}\n${SERVER_MAP[next].desc}`, type: 'info' });
     if(SERVER_MAP[next].isGoal) {
         socket.emit('message', { text: 'PAYLOAD SECURED. +2000 ODZ', type: 'success' });
         delete ADVENTURE_SESSIONS[socket.id];
     }
  });

  socket.on('disconnect', () => delete ADVENTURE_SESSIONS[socket.id]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`>> ONLINE ${PORT}`));
