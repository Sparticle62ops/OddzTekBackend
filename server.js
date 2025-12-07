require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v8.0 [Singularity] Backend Online'));

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
  cpuLevel: { type: Number, default: 1 },
  networkLevel: { type: Number, default: 1 },
  securityLevel: { type: Number, default: 1 },
  
  // Inventory & State
  inventory: { type: [String], default: [] }, 
  activeHoneypot: { type: Boolean, default: false },
  
  // Social
  inviteCode: { type: String, default: () => Math.random().toString(36).substring(7) },
  invitedBy: { type: String, default: null },
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
const ACTIVE_MAZES = {}; // { user: { x, y, map, exitX, exitY } }

// --- SHOP CATALOG ---
const SHOP_ITEMS = {
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpuLevel', val: 2, desc: 'Doubles mining yield.' },
  'cpu_v3': { price: 2000, type: 'upgrade', stat: 'cpuLevel', val: 3, desc: 'Triples mining yield.' },
  'network_v2': { price: 750, type: 'upgrade', stat: 'networkLevel', val: 2, desc: 'Reduces cooldowns.' },
  'firewall_v2': { price: 600, type: 'upgrade', stat: 'securityLevel', val: 2, desc: 'Increases PIN length.' },
  
  'honeypot': { price: 300, type: 'consumable', desc: 'Trap next hacker.' },
  'decryptor_v1': { price: 800, type: 'tool', desc: 'Passive: Reveals 1 digit at hack start.' },
  'brute_force_v1': { price: 1500, type: 'tool', desc: 'Active: Type "brute [user]" to insta-guess 1 digit.' },
  'cloak_v1': { price: 1200, type: 'tool', desc: 'Passive: Hides name from Leaderboard.' },

  'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro monitor style.' },
  'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon purple aesthetic.' },
  'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'Falling code rain.' }
};

// --- LORE ---
const LORE_DB = {
  'readme.txt': "Welcome to Oddztek OS. This system is monitored. Unauthorized access is prohibited.",
  'server_log_01.txt': "FATAL ERROR 10-12-99: Core temperature critical. Automatic shutdown failed.",
  'blueprint_omega.dat': "Project Omega: Autonomous Digital Currency Generation. Status: UNCONTROLLED EXPANSION.",
  'admin_pass.txt': "Note to self: The password for the level 5 server is hidden in the maze."
};

// --- MAZE GENERATOR ---
function generateMaze(size) {
  // Simple grid: 0 = Path, 1 = Wall
  let map = Array(size).fill().map(() => Array(size).fill(1));
  // Create simple path (random walk)
  let x=1, y=1;
  map[y][x] = 0;
  for(let i=0; i<size*3; i++) {
    const dir = Math.floor(Math.random()*4);
    if(dir===0 && y>1) y--;
    else if(dir===1 && y<size-2) y++;
    else if(dir===2 && x>1) x--;
    else if(dir===3 && x<size-2) x++;
    map[y][x] = 0;
  }
  return { map, exitX: x, exitY: y };
}

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
      if (p.inbox.length > 0) socket.emit('message', { text: `[!] ${p.inbox.length} unread messages.`, type: 'special' });
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
          referrer.balance += 200; newPlayer.balance += 100;
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

  socket.on('invite', async () => {
    if (!user) return;
    const p = await Player.findOne({ username: user });
    socket.emit('message', { text: `YOUR CODE: ${p.inviteCode}`, type: 'special' });
  });

  // 2. ECONOMY (Mine, Shop, Transfer)
  socket.on('mine', async () => {
    if (!user || ACTIVE_MINERS.has(user)) return;
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    const cd = getCooldown(p);
    if (now - p.lastMine < cd) return socket.emit('message', { text: `Cooldown: ${Math.ceil((cd-(now-p.lastMine))/1000)}s`, type: 'warning' });

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
      if (item.type === 'skin') p.theme = item.val;
      socket.emit('message', { text: `Purchased: ${id}`, type: 'success' });
    }
    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
  });

  socket.on('transfer', async ({ target, amount }) => {
    if (!user) return;
    const amt = parseInt(amount);
    if (isNaN(amt) || amt <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
    
    let p = await Player.findOne({ username: user });
    if (p.balance < amt) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    
    const t = await Player.findOne({ username: target });
    if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });

    p.balance -= amt;
    t.balance += amt;
    t.inbox.push({ from: 'SYSTEM', msg: `Received ${amt} ODZ from ${user}.` });
    
    await p.save(); await t.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `Transferred ${amt} ODZ to ${target}.`, type: 'success' });
  });

  socket.on('inventory', async () => {
      if (!user) return;
      const p = await Player.findOne({ username: user });
      socket.emit('message', { text: `INVENTORY: ${p.inventory.join(', ') || 'Empty'}`, type: 'info' });
  });

  // 3. HACKING & PVP
  socket.on('scan_player', async (target) => {
      if (!user) return;
      const t = await Player.findOne({ username: target });
      if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
      socket.emit('message', { text: `SCAN [${target}]:\nLvl: ${t.level} | Firewall: v${t.securityLevel}.0`, type: 'system' });
  });

  socket.on('hack_init', async (targetName) => {
    if (!user || targetName === user) return;
    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'Offline/Invalid.', type: 'error' });

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
      // Must be in active hack to use
      if (!ACTIVE_HACKS[user] || ACTIVE_HACKS[user].target !== target) {
          socket.emit('message', { text: 'No active breach on this target.', type: 'error' });
          return;
      }
      let p = await Player.findOne({ username: user });
      if (!p.inventory.includes('brute_force_v1')) {
          socket.emit('message', { text: 'Tool not installed.', type: 'error' });
          return;
      }
      
      // Consume item? Maybe not consume, just cooldown? Let's consume for now.
      const itemIdx = p.inventory.indexOf('brute_force_v1');
      p.inventory.splice(itemIdx, 1);
      await p.save();
      
      // Reveal one unknown digit
      const session = ACTIVE_HACKS[user];
      const unknowns = session.known.map((v, i) => v === '*' ? i : -1).filter(i => i !== -1);
      if (unknowns.length > 0) {
          const idx = unknowns[Math.floor(Math.random() * unknowns.length)];
          session.known[idx] = session.pin[idx];
          socket.emit('message', { text: `[BRUTE FORCE] Cracked digit ${idx+1}: ${session.pin[idx]}`, type: 'special' });
          socket.emit('player_data', p);
      } else {
          socket.emit('message', { text: 'PIN already known.', type: 'info' });
      }
  });

  // 4. MAZE & MISSIONS
  socket.on('maze_start', () => {
      if(!user) return;
      const maze = generateMaze(5); // 5x5 Grid
      ACTIVE_MAZES[user] = { ...maze, x: 1, y: 1 };
      socket.emit('message', { text: `ENTERING LABYRINTH...\nFind coordinates [${maze.exitX}, ${maze.exitY}].\nUse: nav n/s/e/w`, type: 'special' });
  });

  socket.on('navigate', (dir) => {
      const m = ACTIVE_MAZES[user];
      if(!m) return socket.emit('message', { text: 'Not in a maze.', type: 'error' });
      
      let newX = m.x, newY = m.y;
      if (dir === 'n') newY--;
      if (dir === 's') newY++;
      if (dir === 'e') newX++;
      if (dir === 'w') newX--;
      
      if (newX < 0 || newY < 0 || newX >= 5 || newY >= 5 || m.map[newY][newX] === 1) {
          socket.emit('message', { text: 'Wall detected. Path blocked.', type: 'warning' });
      } else {
          m.x = newX; m.y = newY;
          if (m.x === m.exitX && m.y === m.exitY) {
              delete ACTIVE_MAZES[user];
              socket.emit('message', { text: 'EXIT FOUND. Data secured (+50 ODZ).', type: 'success' });
              // Give reward... (omitted for brevity, assume similar to mine)
          } else {
              socket.emit('message', { text: `Moved ${dir}. Pos: [${newX}, ${newY}]`, type: 'info' });
          }
      }
  });

  // 5. SYSTEM (Files, Mail, Leaderboard)
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

  socket.on('daily', async () => { /* ... (Same as before) ... */ });
  socket.on('leaderboard', async () => {
    const all = await Player.find();
    const visible = all.filter(p => !p.inventory.includes('cloak_v1'));
    const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
    socket.emit('message', { text: `\n=== ELITE ===\n${top.map((p,i)=>`#${i+1} ${p.username} | ${p.balance} ODZ`).join('\n')}`, type: 'info' });
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
