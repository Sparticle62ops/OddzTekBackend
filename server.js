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

const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String },
  balance: { type: Number, default: 0 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  // Stats
  cpu: { type: Number, default: 1 },
  botnet: { type: Number, default: 0 },
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  faction: { type: String, default: null },
  files: { type: [String], default: ['readme.txt'] },
  inbox: { type: [{ from: String, body: String, read: Boolean, subject: String }], default: [] },
  // Timers
  lastMine: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  // Tools
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

const SHOP = {
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpu', val: 2, desc: 'Mining Yield x2' },
  'bot_node': { price: 2500, type: 'bot', desc: 'Passive Income (+20 ODZ/min)' },
  'brute_v1': { price: 2000, type: 'tool', desc: 'Auto-crack 1 digit' },
  'spoofer': { price: 3500, type: 'consumable', desc: 'Mask IP for 10m' },
  'logic_bomb': { price: 5000, type: 'consumable', desc: 'Destroy target mine' },
  'honeypot': { price: 500, type: 'consumable', desc: 'Trap hackers' },
  'theme_amber': { price: 200, type: 'skin', val: 'amber' },
  'theme_plasma': { price: 500, type: 'skin', val: 'plasma' },
  'theme_matrix': { price: 1000, type: 'skin', val: 'matrix' }
};

const FILE_CONTENTS = { 'readme.txt': "Oddztek v10.5\nWarning: System Monitored." };
const SERVER_MAP = {
  'lobby': { desc: "Lobby. Exits: [north]", exits: { north: 'firewall' } },
  'firewall': { desc: "Firewall (Locked). Exits: [south, north]. Req: [brute_v1]", locked: true, req: 'brute_v1', exits: { south: 'lobby', north: 'core' } },
  'core': { desc: "CORE. Exits: [south].", exits: { south: 'firewall' }, isGoal: true }
};
const DIR_MAP = { n: 'north', s: 'south', e: 'east', w: 'west' };
let ACTIVE_HACKS = {}; 
let ADVENTURE_SESSIONS = {};

// Passive Income Loop
setInterval(async () => {
  try {
    const players = await Player.find({ botnet: { $gt: 0 } });
    for(const p of players) { p.balance += p.botnet * 20; await p.save(); }
  } catch(e) {}
}, 60000);

io.on('connection', (socket) => {
  let user = null;

  const sendMail = async (target, from, subj, body) => {
    try {
      const p = await Player.findOne({ username: target });
      if(p) {
        p.inbox.unshift({ from, subject: subj, body, read: false });
        await p.save();
        return true;
      }
      return false;
    } catch(e) { return false; }
  };

  socket.on('ping', () => socket.emit('pong'));

  socket.on('register', async ({ username, password }) => {
    try {
      if (await Player.findOne({ username })) return socket.emit('message', { text: 'Taken.', type: 'error' });
      const p = new Player({ username, password });
      await p.save();
      sendMail(username, "System", "Welcome", "Type 'help' to begin.");
      socket.emit('message', { text: 'Registered.', type: 'success' });
    } catch (e) { socket.emit('message', { text: 'DB Error.', type: 'error' }); }
  });

  socket.on('login', async ({ username, password }) => {
    try {
      const p = await Player.findOne({ username, password });
      if (!p) return socket.emit('message', { text: 'Invalid.', type: 'error' });
      p.token = crypto.randomBytes(16).toString('hex');
      await p.save();
      user = username;
      socket.emit('player_data', p);
      socket.emit('message', { text: `Welcome ${username}.`, type: 'success' });
      socket.emit('play_sound', 'login');
    } catch (e) { socket.emit('message', { text: 'Login Error.', type: 'error' }); }
  });

  socket.on('login_token', async (token) => {
    try {
      const p = await Player.findOne({ token });
      if (p) {
        user = p.username;
        socket.emit('player_data', p);
        socket.emit('message', { text: `Welcome back ${user}.`, type: 'success' });
      }
    } catch (e) {}
  });

  socket.on('mine', async () => {
    if(!user) return;
    try {
      const p = await Player.findOne({ username: user });
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
    } catch(e) { console.error(e); }
  });

  socket.on('daily', async () => {
    if(!user) return;
    try {
      const p = await Player.findOne({ username: user });
      if(Date.now() - p.lastDaily < 86400000) return socket.emit('message', { text: 'Already claimed.', type: 'error' });
      const r = 100 * p.level;
      p.balance += r; p.lastDaily = Date.now();
      await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `Daily: +${r}`, type: 'success' });
    } catch(e) {}
  });

  socket.on('leaderboard', async () => {
    try {
      const top = await Player.find().sort({ balance: -1 }).limit(5);
      let list = "TOP 5:\n";
      top.forEach((p,i) => list += `#${i+1} ${p.username}: ${p.balance}\n`);
      socket.emit('message', { text: list, type: 'info' });
    } catch(e) {}
  });

  socket.on('shop', () => {
     let list = "MARKET:\n";
     for(const [k,v] of Object.entries(SHOP)) list += `[${k}] ${v.price} - ${v.desc || ''}\n`;
     socket.emit('message', { text: list, type: 'info' });
  });

  socket.on('buy', async (id) => {
     if(!user) return;
     try {
       const p = await Player.findOne({ username: user });
       const i = SHOP[id];
       if(!i || p.balance < i.price) return socket.emit('message', { text: 'Cannot buy.', type: 'error' });
       p.balance -= i.price;
       if(i.type === 'upgrade') p[i.stat] = i.val;
       else if(i.type === 'bot') p.botnet++;
       else p.inventory.push(id);
       await p.save();
       socket.emit('player_data', p);
       socket.emit('message', { text: `Bought ${id}`, type: 'success' });
     } catch(e) {}
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

  socket.on('mail_send', async ({ recipient, body }) => {
     if(!user) return;
     if(await sendMail(recipient, user, "Msg", body)) socket.emit('message', { text: 'Sent.', type: 'success' });
     else socket.emit('message', { text: 'User not found.', type: 'error' });
  });

  socket.on('mail_check', async () => {
     if(!user) return;
     const p = await Player.findOne({ username: user });
     let list = "INBOX:\n";
     p.inbox.forEach((m,i) => list += `[${i+1}] ${m.from}: ${m.subject || 'Msg'}\n`);
     socket.emit('message', { text: list, type: 'info' });
  });
  
  socket.on('mail_read', async (id) => {
     if(!user) return;
     const p = await Player.findOne({ username: user });
     const m = p.inbox[id-1];
     if(m) socket.emit('message', { text: `FROM: ${m.from}\nMSG: ${m.body}`, type: 'info' });
  });

  socket.on('scan', async (target) => {
    try {
       const t = await Player.findOne({ username: target });
       if(!t) return socket.emit('message', { text: 'Not found.', type: 'error' });
       socket.emit('message', { text: `SCAN: Level ${t.level} | Bal: ~${t.balance}`, type: 'info' });
    } catch(e) {}
  });

  socket.on('hack_init', async (target) => {
    if(!user || target === user) return;
    if(ACTIVE_HACKS[user]) return socket.emit('message', { text: 'Busy.', type: 'error' });
    const t = await Player.findOne({ username: target });
    if(!t) return socket.emit('message', { text: 'Offline.', type: 'error' });
    
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    ACTIVE_HACKS[user] = { target, pin, attempts: 5 };
    socket.emit('message', { text: `LINKED: ${target}\nPIN: ****`, type: 'special' });
  });

  socket.on('guess', async (pin) => {
    const s = ACTIVE_HACKS[user];
    if(!s) return socket.emit('message', { text: 'No hack.', type: 'error' });
    if(pin === s.pin) {
      delete ACTIVE_HACKS[user];
      const p = await Player.findOne({ username: user });
      const t = await Player.findOne({ username: s.target });
      const steal = Math.floor(t.balance * 0.2);
      t.balance -= steal; p.balance += steal;
      await p.save(); await t.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `SUCCESS. +${steal}`, type: 'success' });
    } else {
      s.attempts--;
      if(s.attempts <= 0) { delete ACTIVE_HACKS[user]; socket.emit('message', { text: 'LOCKOUT.', type: 'error' }); }
      else {
        const hint = pin < s.pin ? 'Higher' : 'Lower';
        socket.emit('message', { text: `Incorrect (${hint}).`, type: 'warning' });
      }
    }
  });

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
     if(SERVER_MAP[next].locked) return socket.emit('message', { text: `LOCKED. Need ${SERVER_MAP[next].req}`, type: 'warning' });
     sess.node = next;
     socket.emit('message', { text: `> ${dir}\n${SERVER_MAP[next].desc}`, type: 'info' });
     if(SERVER_MAP[next].isGoal) {
         socket.emit('message', { text: 'DATA SECURED. +2000 ODZ', type: 'success' });
         delete ADVENTURE_SESSIONS[socket.id];
     }
  });

  socket.on('faction_create', async (name) => {
     if(!user) return;
     if(await Faction.findOne({ name })) return socket.emit('message', { text: 'Taken.', type: 'error' });
     const f = new Faction({ name, leader: user, members: [user] });
     await f.save();
     const p = await Player.findOne({ username: user });
     p.faction = name; await p.save();
     socket.emit('player_data', p);
     socket.emit('message', { text: `Faction ${name} created.`, type: 'success' });
  });

  socket.on('faction_join', async (name) => {
     if(!user) return;
     const f = await Faction.findOne({ name });
     if(!f) return socket.emit('message', { text: 'Not found.', type: 'error' });
     f.members.push(user); await f.save();
     const p = await Player.findOne({ username: user });
     p.faction = name; await p.save();
     socket.emit('player_data', p);
     socket.emit('message', { text: `Joined ${name}.`, type: 'success' });
  });

  socket.on('faction_chat', (msg) => {
     if(user) io.emit('message', { text: `[FACTION] ${user}: ${msg}`, type: 'info' });
  });

  socket.on('global_chat', (m) => io.emit('message', { text: `[CHAT] ${user}: ${m}`, type: 'info' }));
  
  socket.on('coinflip', async ({ side, amount }) => {
    if(!user) return;
    try {
      const amt = parseInt(amount);
      if(isNaN(amt)) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
      const p = await Player.findOne({ username: user });
      if(p.balance < amt) return socket.emit('message', { text: 'No funds.', type: 'error' });
      const res = Math.random() > 0.5 ? 'heads' : 'tails';
      if(side === res) { p.balance += amt; socket.emit('message', { text: 'YOU WON!', type: 'success' }); }
      else { p.balance -= amt; socket.emit('message', { text: 'YOU LOST.', type: 'error' }); }
      await p.save();
      socket.emit('player_data', p);
    } catch (e) {}
  });

  socket.on('transfer', async ({ target, amount }) => {
    if(!user) return;
    try {
      const amt = parseInt(amount);
      if(isNaN(amt)) return;
      const p = await Player.findOne({ username: user });
      const t = await Player.findOne({ username: target });
      if(p.balance < amt || !t) return;
      p.balance -= amt; t.balance += amt;
      await p.save(); await t.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `Sent ${amt}.`, type: 'success' });
    } catch(e) {}
  });

  socket.on('set_theme', async (t) => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    p.theme = t;
    await p.save();
    socket.emit('player_data', p);
  });
  
  socket.on('inventory', async () => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    socket.emit('message', { text: `INV: ${p.inventory.join(', ') || 'Empty'}`, type: 'info' });
  });

  socket.on('disconnect', () => delete ADVENTURE_SESSIONS[socket.id]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`>> ONLINE ${PORT}`));
