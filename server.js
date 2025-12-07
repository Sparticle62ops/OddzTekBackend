require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v9.0 [OMNIPOTENCE] Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('>> MongoDB Connected'))
  .catch(err => console.error('>> DB Error:', err));

// --- PLAYER SCHEMA (v9.0) ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  theme: { type: String, default: 'green' }, // Persist theme choice
  
  // Hardware Stats
  cpuLevel: { type: Number, default: 1 },      
  networkLevel: { type: Number, default: 1 },  
  securityLevel: { type: Number, default: 1 }, 
  
  // Inventory & State
  inventory: { type: [String], default: [] }, 
  activeHoneypot: { type: Boolean, default: false },
  
  // Social & Chat
  inviteCode: { type: String, default: () => Math.random().toString(36).substring(7) },
  invitedBy: { type: String, default: null },
  inbox: { type: [{ from: String, msg: String, read: Boolean, date: { type: Date, default: Date.now } }], default: [] }, // Updated for Read status

  // Stats Tracking
  winsFlip: { type: Number, default: 0 },
  lossesFlip: { type: Number, default: 0 },

  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  
  // File System & Missions
  files: { type: [String], default: ['readme.txt'] },
  missionProgress: { type: Object, default: {} } // For tracking maze/server hack state
});
const Player = mongoose.model('Player', playerSchema);

// --- GLOBAL GAME CONSTANTS ---
const LEVEL_XP_REQ = 200;
const MINE_DURATION = 20000;
const MINE_TICK = 5000;
const BASE_MINE_COOLDOWN = 20000;
const HACK_COOLDOWN = 60000;

// --- STATE ---
const ACTIVE_MINERS = new Set(); 
const ACTIVE_HACKS = {}; 
const ACTIVE_MAZES = {}; 
const SERVER_HACK_SESSIONS = {}; // For the Server Hack Mission

// --- SHOP CATALOG (Expanded) ---
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
  'brute_force_v1': { price: 1500, type: 'tool', desc: 'Active: Type "brute [user]" to insta-guess 1 digit.' },
  'cloak_v1': { price: 1200, type: 'tool', desc: 'Passive: Hides name from Leaderboard.' },

  // SKINS
  'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro monitor style.' },
  'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon purple aesthetic.' },
  'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'The code is real.' }
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

  // 1. AUTHENTICATION & THEME
  socket.on('login', async ({ username, password }) => {
    try {
      const p = await Player.findOne({ username });
      if (!p || p.password !== password) return socket.emit('message', { text: 'Access Denied.', type: 'error' });
      user = username;
      socket.emit('player_data', p);
      socket.emit('message', { text: `Welcome back, Agent ${username}.`, type: 'success' });
      
      const unread = p.inbox.filter(m => !m.read).length;
      if (unread > 0) socket.emit('message', { text: `[!] ${unread} unread messages.`, type: 'special' });
      
      socket.emit('play_sound', 'login');
    } catch (e) { console.error(e); }
  });

  socket.on('register', async ({ username, password, referralCode }) => {
    try {
      if (await Player.findOne({ username })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
      const newPlayer = new Player({ username, password });
      
      if (referralCode) {
        const referrer = await Player.findOne({ inviteCode: referralCode });
        if (referrer) {
          referrer.balance += 200; 
          newPlayer.balance += 100;
          newPlayer.invitedBy = referrer.username;
          await referrer.save();
          socket.emit('message', { text: `Referral applied.`, type: 'special' });
        }
      }
      await newPlayer.save();
      user = username;
      socket.emit('player_data', newPlayer);
      socket.emit('message', { text: 'Account created.', type: 'success' });
    } catch (e) { console.error(e); }
  });

  // 2. MINING (Optimized)
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
  // 3. SHOP & INVENTORY
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

    const count = p.inventory.filter(i => i === id).length;
    if (item.type !== 'upgrade' && item.type !== 'skin' && count >= 2) return socket.emit('message', { text: 'Inventory Limit (2).', type: 'error' });

    p.balance -= item.price;
    if (item.type === 'upgrade') {
      if (p[item.stat] >= item.val) return socket.emit('message', { text: 'Already owned.', type: 'error' });
      p[item.stat] = item.val;
      socket.emit('message', { text: `Upgraded: ${id}`, type: 'success' });
    } else if (id === 'honeypot') {
      p.activeHoneypot = true;
      socket.emit('message', { text: 'Honeypot ARMED.', type: 'special' });
    } else {
      if (!p.inventory.includes(id)) p.inventory.push(id);
      socket.emit('message', { text: `Purchased: ${id}`, type: 'success' });
    }
    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
  });

  socket.on('inventory', async () => {
      if (!user) return;
      const p = await Player.findOne({ username: user });
      socket.emit('message', { text: `INVENTORY: ${p.inventory.join(', ') || 'Empty'}`, type: 'info' });
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
    const visible = all.filter(p => !p.inventory.includes('cloak_v1'));
    const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
    socket.emit('message', { text: `\n=== ELITE ===\n${top.map((p,i)=>`#${i+1} ${p.username} | ${p.balance} ODZ`).join('\n')}`, type: 'info' });
  });

  // 5. PVP HACKING
  socket.on('hack_init', async (targetName) => {
    if (!user || targetName === user) return;
    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'Target offline/not found.', type: 'error' });

    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastHack < HACK_COOLDOWN) return socket.emit('message', { text: 'Cooldown Active.', type: 'warning' });

    if (target.activeHoneypot) {
      const fine = Math.floor(p.balance * 0.5);
      p.balance -= fine; target.activeHoneypot = false; target.balance += fine;
      await p.save(); await target.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `TRAP DETECTED! Lost ${fine} ODZ!`, type: 'error' });
      socket.emit('play_sound', 'error');
      return;
    }

    const pin = generatePin(target.securityLevel);
    let known = Array(pin.length).fill('*');
    let extra = "";

    if (p.inventory.includes('decryptor_v1')) {
        const idx = Math.floor(Math.random() * pin.length);
        known[idx] = pin[idx];
        extra = `\n[DECRYPTOR] Revealed digit at ${idx+1}`;
    }

    ACTIVE_HACKS[user] = { target: targetName, pin, attempts: 6, expires: Date.now() + 45000, known };
    socket.emit('message', { text: `BREACH STARTED on ${targetName}.\nPIN: [ ${known.join(' ')} ]${extra}\nType: guess [pin]`, type: 'special' });
    socket.emit('play_sound', 'login');
  });

  socket.on('guess', async (val) => {
    const session = ACTIVE_HACKS[user];
    if (!session) return socket.emit('message', { text: 'No active hack.', type: 'error' });
    if (Date.now() > session.expires) { delete ACTIVE_HACKS[user]; return socket.emit('message', { text: 'Timed out.', type: 'error' }); }
    
    if (val === session.pin) {
      delete ACTIVE_HACKS[user];
      const t = await Player.findOne({ username: session.target });
      const p = await Player.findOne({ username: user });
      const stolen = Math.floor(t.balance * 0.25);
      t.balance -= stolen; p.balance += stolen; p.lastHack = Date.now(); p.xp += 50;
      await t.save(); await p.save();
      socket.emit('player_data', p);
      socket.emit('message', { text: `ACCESS GRANTED. Stole ${stolen} ODZ.`, type: 'success' });
      socket.emit('play_sound', 'success');
    } else {
      session.attempts--;
      if (session.attempts <= 0) { delete ACTIVE_HACKS[user]; socket.emit('message', { text: 'Lockout.', type: 'error' }); return; }

      let matched = false;
      for(let i=0; i<session.pin.length; i++) {
          if(val[i] === session.pin[i] && session.known[i] === '*') {
              session.known[i] = val[i];
              matched = true;
          }
      }

      const diff = Math.abs(parseInt(val) - parseInt(session.pin));
      let hint = diff <= 20 ? "HOT" : (diff <= 50 ? "WARM" : "COLD");
      const dir = val < session.pin ? "(Higher)" : "(Lower)";
      
      socket.emit('message', { text: `Incorrect. Signal: ${hint} ${dir}.\nPIN: [ ${session.known.join(' ')} ]\nTries: ${session.attempts}`, type: 'warning' });
    }
  });

  socket.on('brute_force', async (target) => {
      if (!ACTIVE_HACKS[user] || ACTIVE_HACKS[user].target !== target) return socket.emit('message', { text: 'No active breach.', type: 'error' });
      let p = await Player.findOne({ username: user });
      if (!p.inventory.includes('brute_force_v1')) return socket.emit('message', { text: 'Tool missing.', type: 'error' });
      
      const idx = p.inventory.indexOf('brute_force_v1');
      p.inventory.splice(idx, 1);
      await p.save();
      
      const s = ACTIVE_HACKS[user];
      const unknown = s.known.map((v, i) => v === '*' ? i : -1).filter(i => i !== -1);
      if (unknown.length > 0) {
          const k = unknown[Math.floor(Math.random() * unknown.length)];
          s.known[k] = s.pin[k];
          socket.emit('message', { text: `[BRUTE] Cracked digit ${k+1}: ${s.pin[k]}`, type: 'special' });
          socket.emit('player_data', p);
      }
  });

  // 6. SYSTEM (Theme, Mail, Transfer, Chat)
  socket.on('set_theme', async (themeName) => {
      if(!user) return;
      if (['green','amber','plasma','matrix'].includes(themeName)) {
          let p = await Player.findOne({ username: user });
          // Check ownership for premium themes
          if (themeName !== 'green' && !p.inventory.includes(`theme_${themeName}`)) {
              return socket.emit('message', { text: 'Theme locked. Buy in shop.', type: 'error' });
          }
          p.theme = themeName;
          await p.save();
          socket.emit('player_data', p);
          socket.emit('message', { text: `Theme set: ${themeName}`, type: 'success' });
      }
  });

  socket.on('global_chat', (msg) => {
      if(!user) return;
      // Broadcast to everyone
      io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
  });

  socket.on('mail_read', async (idx) => {
      if(!user) return;
      const p = await Player.findOne({ username: user });
      const i = parseInt(idx) - 1;
      if (p.inbox[i]) {
          p.inbox[i].read = true;
          await p.save();
          socket.emit('message', { text: `Message marked read.`, type: 'success' });
      }
  });

  socket.on('transfer', async ({ target, amount }) => {
    if (!user) return;
    const amt = parseInt(amount);
    if (isNaN(amt) || amt <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
    let p = await Player.findOne({ username: user });
    if (p.balance < amt) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    const t = await Player.findOne({ username: target });
    if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });

    p.balance -= amt; t.balance += amt;
    t.inbox.push({ from: 'SYSTEM', msg: `Received ${amt} ODZ from ${user}.`, read: false });
    await p.save(); await t.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Transferred ${amt} ODZ.`, type: 'success' });
  });

  // 7. MINIGAMES (Coinflip)
  socket.on('coinflip', async ({ side, amount }) => {
      if(!user) return;
      const amt = parseInt(amount);
      if(isNaN(amt) || amt <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
      let p = await Player.findOne({ username: user });
      if(p.balance < amt) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });

      const result = Math.random() > 0.5 ? 'heads' : 'tails';
      const win = (side.toLowerCase() === result);
      
      if(win) {
          p.balance += amt; p.winsFlip++;
          socket.emit('message', { text: `Result: ${result.toUpperCase()}. YOU WON +${amt} ODZ!`, type: 'success' });
          socket.emit('play_sound', 'success');
      } else {
          p.balance -= amt; p.lossesFlip++;
          socket.emit('message', { text: `Result: ${result.toUpperCase()}. You lost ${amt} ODZ.`, type: 'error' });
          socket.emit('play_sound', 'error');
      }
      await p.save();
      socket.emit('player_data', p);
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
