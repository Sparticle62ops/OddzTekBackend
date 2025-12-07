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
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  theme: { type: String, default: 'green' },
  inventory: { type: [String], default: [] },
  inbox: { type: [{ from: String, body: String, read: Boolean }], default: [] },
  lastMine: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

const SHOP = {
  'cpu_v2': { price: 500, desc: 'Mining Yield x2' },
  'theme_amber': { price: 200, desc: 'Amber Theme' },
  'theme_plasma': { price: 500, desc: 'Plasma Theme' },
  'theme_matrix': { price: 1000, desc: 'Matrix Theme' }
};

let ACTIVE_HACKS = {};

io.on('connection', (socket) => {
  let user = null;

  socket.on('ping', () => socket.emit('pong'));

  socket.on('register', async ({ username, password }) => {
    try {
      if (await Player.findOne({ username })) return socket.emit('message', { text: 'Taken.', type: 'error' });
      const p = new Player({ username, password });
      await p.save();
      socket.emit('message', { text: 'Registered.', type: 'success' });
    } catch (e) { socket.emit('message', { text: 'Error registering.', type: 'error' }); }
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
    } catch (e) { socket.emit('message', { text: 'Login error.', type: 'error' }); }
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
      if(Date.now() - p.lastMine < 5000) return socket.emit('message', { text: 'Cooldown.', type: 'warning' });
      const gain = 10 * (p.inventory.includes('cpu_v2') ? 2 : 1);
      p.balance += gain;
      p.xp += 10;
      p.lastMine = Date.now();
      if(p.xp >= p.level * 100) { p.level++; p.xp=0; socket.emit('message', { text: 'LEVEL UP!', type: 'special' }); }
      await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `Mined +${gain}`, type: 'success' });
    } catch (e) { console.error(e); }
  });

  socket.on('shop', () => {
    let list = "MARKET:\n";
    for(const [k,v] of Object.entries(SHOP)) list += `[${k}] ${v.price} - ${v.desc}\n`;
    socket.emit('message', { text: list, type: 'info' });
  });

  socket.on('buy', async (id) => {
    if(!user) return;
    try {
      const p = await Player.findOne({ username: user });
      const item = SHOP[id];
      if(!item || p.balance < item.price) return socket.emit('message', { text: 'Cannot buy.', type: 'error' });
      p.balance -= item.price;
      p.inventory.push(id);
      await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `Bought ${id}`, type: 'success' });
    } catch (e) {}
  });

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

  socket.on('global_chat', (msg) => {
    if(user) io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
  });

  socket.on('mail_send', async ({ recipient, body }) => {
    if(!user) return;
    try {
      const p = await Player.findOne({ username: recipient });
      if(!p) return socket.emit('message', { text: 'User not found.', type: 'error' });
      p.inbox.unshift({ from: user, body: body, read: false });
      await p.save();
      socket.emit('message', { text: 'Sent.', type: 'success' });
    } catch (e) {}
  });

  socket.on('mail_check', async () => {
    if(!user) return;
    try {
      const p = await Player.findOne({ username: user });
      let list = "INBOX:\n";
      p.inbox.forEach((m, i) => list += `[${i+1}] ${m.from}: ${m.body.substring(0, 15)}...\n`);
      socket.emit('message', { text: list, type: 'info' });
    } catch (e) {}
  });

  socket.on('mail_read', async (id) => {
    if(!user) return;
    try {
      const p = await Player.findOne({ username: user });
      const m = p.inbox[id-1];
      if(m) socket.emit('message', { text: `FROM: ${m.from}\nMSG: ${m.body}`, type: 'info' });
    } catch (e) {}
  });

  socket.on('hack_init', async (target) => {
    if(!user || target === user) return;
    if(ACTIVE_HACKS[user]) return socket.emit('message', { text: 'Hack already active.', type: 'error' });
    const t = await Player.findOne({ username: target });
    if(!t) return socket.emit('message', { text: 'Target offline.', type: 'error' });
    
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    ACTIVE_HACKS[user] = { target, pin, attempts: 5 };
    socket.emit('message', { text: `CONNECTING TO ${target}...\nPIN: ****`, type: 'special' });
  });

  socket.on('guess', async (pin) => {
    const s = ACTIVE_HACKS[user];
    if(!s) return socket.emit('message', { text: 'No hack active.', type: 'error' });
    
    if(pin === s.pin) {
      delete ACTIVE_HACKS[user];
      const p = await Player.findOne({ username: user });
      const t = await Player.findOne({ username: s.target });
      const steal = Math.floor(t.balance * 0.2);
      t.balance -= steal; p.balance += steal;
      await p.save(); await t.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `SUCCESS. Stole ${steal} ODZ.`, type: 'success' });
    } else {
      s.attempts--;
      if(s.attempts <= 0) { delete ACTIVE_HACKS[user]; socket.emit('message', { text: 'LOCKOUT.', type: 'error' }); }
      else {
        const hint = pin < s.pin ? 'Higher' : 'Lower';
        socket.emit('message', { text: `Incorrect (${hint}).`, type: 'warning' });
      }
    }
  });

  socket.on('set_theme', async (t) => {
    if(!user) return;
    const p = await Player.findOne({ username: user });
    p.theme = t;
    await p.save();
    socket.emit('player_data', p);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`>> SERVER ONLINE on port ${PORT}`));
