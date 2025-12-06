require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek Backend v4.0 Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB Error:', err));

// --- DATA MODELS ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 50 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  
  // Gameplay States
  firewallLevel: { type: Number, default: 1 }, // Higher level = Harder PIN
  cpuLevel: { type: Number, default: 1 },      // Higher level = More mining yield
  isCompromised: { type: Boolean, default: false }, // Forced password change
  
  // Cooldowns
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// Active Mining Sessions (In-Memory)
const activeMiners = new Set();
// Active Hacking Sessions: { attacker: { target, pin, attemptsLeft, expires } }
const activeHacks = {};

const MINE_DURATION = 40000; // 40s
const MINE_COOLDOWN = 20000; // 20s
const HACK_DURATION = 30000; // 30s to guess PIN

// --- HELPERS ---
function generatePin(level) {
  // Level 1: 3 digits, Level 2: 4 digits, Level 3+: 5 digits
  const len = level === 1 ? 3 : (level === 2 ? 4 : 5);
  let pin = '';
  for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

io.on('connection', (socket) => {
  let currentUser = null;

  // 1. AUTHENTICATION
  socket.on('login', async ({ username, password }) => {
    const player = await Player.findOne({ username });
    if (!player || player.password !== password) {
      socket.emit('message', { text: 'Invalid Credentials.', type: 'error' });
      return;
    }
    
    currentUser = username;
    socket.emit('player_data', player);
    
    if (player.isCompromised) {
      socket.emit('message', { 
        text: 'WARNING: SECURITY BREACH DETECTED. SYSTEM COMPROMISED. \nCOMMAND: passwd [new_password] REQUIRED IMMEDIATELY.', 
        type: 'error' 
      });
    } else {
      socket.emit('message', { text: `Welcome back, ${username}.`, type: 'success' });
    }
  });

  socket.on('register', async ({ username, password }) => {
    try {
      if (await Player.findOne({ username })) {
        socket.emit('message', { text: 'Username taken.', type: 'error' });
        return;
      }
      const newPlayer = await Player.create({ username, password });
      currentUser = username;
      socket.emit('player_data', newPlayer);
      socket.emit('message', { text: 'Account created.', type: 'success' });
    } catch(e) { socket.emit('message', { text: 'Error creating account.', type: 'error' }); }
  });

  socket.on('passwd', async (newPass) => {
    if (!currentUser) return;
    let player = await Player.findOne({ username: currentUser });
    player.password = newPass;
    player.isCompromised = false; // Reset breach status
    await player.save();
    socket.emit('message', { text: 'Password updated. Security restored.', type: 'success' });
  });

  // 2. REALISTIC MINING
  socket.on('mine', async () => {
    if (!currentUser) return;
    if (activeMiners.has(currentUser)) {
      socket.emit('message', { text: 'Mining process already active.', type: 'error' });
      return;
    }

    let player = await Player.findOne({ username: currentUser });
    const now = Date.now();
    
    if (now - player.lastMine < MINE_COOLDOWN) {
      const wait = Math.ceil((MINE_COOLDOWN - (now - player.lastMine))/1000);
      socket.emit('message', { text: `Mining Cooldown: ${wait}s remaining.`, type: 'error' });
      return;
    }

    // Start Mining
    activeMiners.add(currentUser);
    socket.emit('message', { text: `[SYSTEM] Initializing Miner v${player.cpuLevel}.0... (Duration: 40s)`, type: 'system' });
    
    // Simulate gradual gains
    let ticks = 0;
    const interval = setInterval(() => {
      if (!activeMiners.has(currentUser)) { clearInterval(interval); return; }
      
      // Send "dots" to show progress
      socket.emit('message', { text: `Mining block ${ticks+1}/4...`, type: 'info' });
      ticks++;
      
      if (ticks >= 4) {
        clearInterval(interval);
        finishMining(currentUser, player.cpuLevel);
      }
    }, 10000); // Update every 10 seconds (4 times total = 40s)
  });

  async function finishMining(username, cpuLevel) {
    activeMiners.delete(username);
    let player = await Player.findOne({ username });
    
    const baseReward = 20;
    const totalReward = baseReward * cpuLevel;
    
    player.balance += totalReward;
    player.xp += 10;
    player.lastMine = Date.now();
    
    // Level Up Check
    if (player.xp >= player.level * 100) { player.level++; player.xp = 0; }
    
    await player.save();
    socket.emit('player_data', player);
    socket.emit('message', { text: `MINING COMPLETE. Yield: ${totalReward} ODZ. Cooldown active.`, type: 'success' });
  }

  // 3. COMPLEX HACKING (The Minigame)
  socket.on('hack_init', async (targetName) => {
    if (!currentUser || targetName === currentUser) return;
    
    // Check target existence
    const target = await Player.findOne({ username: targetName });
    if (!target) { socket.emit('message', { text: 'Target offline/not found.', type: 'error' }); return; }

    const pin = generatePin(target.firewallLevel);
    
    activeHacks[currentUser] = {
      target: targetName,
      pin: pin,
      attempts: 5,
      expires: Date.now() + HACK_DURATION
    };

    socket.emit('message', { 
      text: `[BREACH PROTOCOL INITIATED] \nTarget Firewall Level: ${target.firewallLevel} \nCRACK THE PIN: It has ${pin.length} digits. \nUse 'guess [number]' to try. \nTime Limit: 30s.`, 
      type: 'special' 
    });
  });

  socket.on('guess', async (guessAttempt) => {
    const session = activeHacks[currentUser];
    if (!session) { socket.emit('message', { text: 'No active breach session.', type: 'error' }); return; }
    
    if (Date.now() > session.expires) {
      delete activeHacks[currentUser];
      socket.emit('message', { text: 'CONNECTION TIMED OUT. Breach failed.', type: 'error' });
      return;
    }

    if (guessAttempt === session.pin) {
      // SUCCESS
      delete activeHacks[currentUser];
      
      const target = await Player.findOne({ username: session.target });
      const attacker = await Player.findOne({ username: currentUser });
      
      const stolen = Math.floor(target.balance * 0.25); // Steal 25%
      target.balance -= stolen;
      target.isCompromised = true; // FORCE PASS CHANGE
      attacker.balance += stolen;
      attacker.xp += 100;
      
      await target.save();
      await attacker.save();
      
      socket.emit('player_data', attacker);
      socket.emit('message', { text: `ACCESS GRANTED. \nFunds Transferred: ${stolen} ODZ. \nTarget system corrupted.`, type: 'success' });
    
    } else {
      // FAIL GUESS
      session.attempts--;
      let hint = "";
      if (guessAttempt < session.pin) hint = "HIGHER";
      else hint = "LOWER";

      if (session.attempts <= 0) {
        delete activeHacks[currentUser];
        socket.emit('message', { text: 'SECURITY LOCKOUT. Too many failed attempts.', type: 'error' });
      } else {
        socket.emit('message', { text: `Incorrect. Value is ${hint}. Attempts left: ${session.attempts}`, type: 'info' });
      }
    }
  });

  // 4. SHOP & UPGRADES
  socket.on('buy', async (item) => {
    if (!currentUser) return;
    let player = await Player.findOne({ username: currentUser });
    let cost = 0;
    
    if (item === 'cpu_v2') cost = 500;
    else if (item === 'firewall_v2') cost = 800;
    else if (item === 'plasma_skin') cost = 250;
    
    if (player.balance < cost) {
        socket.emit('message', { text: `Insufficient ODZ. Need ${cost}.`, type: 'error' });
        return;
    }

    player.balance -= cost;
    player.inventory.push(item);

    if (item === 'cpu_v2') { player.cpuLevel = 2; socket.emit('message', { text: 'CPU Upgraded. Mining yield doubled.', type: 'success' }); }
    if (item === 'firewall_v2') { player.firewallLevel = 2; socket.emit('message', { text: 'Firewall Upgraded. PIN length increased.', type: 'success' }); }
    if (item === 'plasma_skin') { player.theme = 'plasma'; }

    await player.save();
    socket.emit('player_data', player);
  });
  
  socket.on('shop', () => {
      socket.emit('message', { text: `
=== BLACK MARKET HARDWARE ===
[UPGRADES]
  cpu_v2       - 500 ODZ (2x Mining Speed)
  firewall_v2  - 800 ODZ (Harder PIN for attackers)
[COSMETICS]
  plasma_skin  - 250 ODZ
      `, type: 'info' });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running'));
