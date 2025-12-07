require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // Assuming we use simple tokens or just random strings for now

// --- CONFIG ---
const JWT_SECRET = process.env.JWT_SECRET || "secret_key_123"; 
const PORT = process.env.PORT || 3000;

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v10.0 [Foundation] Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- DATABASE ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('>> MongoDB Connected'))
  .catch(err => console.error('>> DB Error:', err));

// --- SCHEMA ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String }, // For persistence
  balance: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  theme: { type: String, default: 'green' },
  
  // Hardware
  cpuLevel: { type: Number, default: 1 },
  networkLevel: { type: Number, default: 1 },
  securityLevel: { type: Number, default: 1 },
  
  // State
  inventory: { type: [String], default: [] }, 
  activeHoneypot: { type: Boolean, default: false },
  
  // Data
  inbox: { type: [{ from: String, msg: String, read: Boolean, date: Date }], default: [] },
  files: { type: [String], default: ['readme.txt'] },
  
  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// --- GAME LOGIC ---
const SHOP_ITEMS = {
  'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpuLevel', val: 2, desc: '2x Mining' },
  'network_v2': { price: 750, type: 'upgrade', stat: 'networkLevel', val: 2, desc: '-20% Cooldown' },
  'firewall_v2': { price: 600, type: 'upgrade', stat: 'securityLevel', val: 2, desc: 'Harder PINs' },
  'honeypot': { price: 300, type: 'consumable', desc: 'Trap Hacker' },
  'decryptor_v1': { price: 800, type: 'tool', desc: 'Reveal 1 Digit' },
  'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro Theme' },
  'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon Theme' },
  'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'Matrix Theme' }
};

const ACTIVE_MINERS = new Set();
const ACTIVE_HACKS = {}; 

function generatePin(level) {
  const len = level === 1 ? 3 : (level === 2 ? 4 : 5);
  let pin = '';
  for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
  return pin;
}

// --- SOCKET HANDLER ---
io.on('connection', (socket) => {
  let user = null;

  // 1. AUTO-LOGIN (Token)
  socket.on('auth_token', async (token) => {
    try {
      const p = await Player.findOne({ token });
      if (p) {
        user = p.username;
        socket.emit('player_data', p);
        socket.emit('message', { text: `Session Restored: ${p.username}`, type: 'success' });
        socket.emit('play_sound', 'login');
      } else {
        socket.emit('message', { text: 'Session Expired. Please login.', type: 'error' });
      }
    } catch (e) { console.error(e); }
  });

  // 2. UNIFIED COMMAND PARSER
  socket.on('cmd', async ({ command, args }) => {
    try {
      switch (command) {
        // --- AUTH ---
        case 'login': {
          const [u, p_pass] = args;
          if (!u || !p_pass) return socket.emit('message', { text: 'Usage: login [user] [pass]', type: 'error' });
          
          const p = await Player.findOne({ username: u });
          if (!p || p.password !== p_pass) return socket.emit('message', { text: 'Access Denied.', type: 'error' });
          
          // Generate/Save Token
          const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
          p.token = token;
          await p.save();
          
          user = u;
          socket.emit('player_data', p);
          socket.emit('message', { text: `Welcome, Agent ${u}.`, type: 'success' });
          socket.emit('play_sound', 'login');
          break;
        }

        case 'register': {
          const [u, p_pass, code] = args;
          if (!u || !p_pass) return socket.emit('message', { text: 'Usage: register [user] [pass]', type: 'error' });
          if (await Player.findOne({ username: u })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
          
          const newP = new Player({ username: u, password: p_pass });
          if (code) { /* Referral logic here */ }
          await newP.save();
          
          user = u;
          socket.emit('player_data', newP);
          socket.emit('message', { text: 'Account Created.', type: 'success' });
          break;
        }

        // --- ECONOMY ---
        case 'mine': {
          if (!user || ACTIVE_MINERS.has(user)) return;
          let p = await Player.findOne({ username: user });
          
          const now = Date.now();
          const cd = 20000 * (1 - (p.networkLevel-1)*0.1); // Cooldown logic
          if (now - p.lastMine < cd) {
             return socket.emit('message', { text: `System Cooling Down...`, type: 'warning' });
          }

          ACTIVE_MINERS.add(user);
          socket.emit('message', { text: `Mining Cycle Started (20s)...`, type: 'system' });
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
              // Level up check
              if (p.xp >= p.level * 200) { p.level++; p.xp=0; socket.emit('message', { text: 'LEVEL UP!', type: 'special' }); }
              await p.save();
              socket.emit('player_data', p);
              socket.emit('message', { text: 'Mining Complete.', type: 'info' });
            }
          }, 5000);
          break;
        }

        // --- SHOP ---
        case 'shop': {
          let msg = "\n=== BLACK MARKET ===\n";
          for (const [k, v] of Object.entries(SHOP_ITEMS)) msg += `[${k.padEnd(12)}] ${v.price} ODZ - ${v.desc}\n`;
          socket.emit('message', { text: msg, type: 'info' });
          break;
        }

        case 'buy': {
          if (!user) return;
          const id = args[0];
          const item = SHOP_ITEMS[id];
          if (!item) return socket.emit('message', { text: 'Item not found.', type: 'error' });
          
          let p = await Player.findOne({ username: user });
          if (p.balance < item.price) return socket.emit('message', { text: 'Insufficient Funds.', type: 'error' });

          p.balance -= item.price;
          if (item.type === 'skin') p.theme = item.val;
          else if (item.type === 'upgrade') p[item.stat] = item.val;
          else p.inventory.push(id);

          await p.save();
          socket.emit('player_data', p);
          socket.emit('message', { text: `Purchased: ${id}`, type: 'success' });
          socket.emit('play_sound', 'success');
          break;
        }

        // --- HACKING ---
        case 'hack': {
          if (!user) return;
          const targetName = args[0];
          if (!targetName || targetName === user) return socket.emit('message', { text: 'Invalid Target.', type: 'error' });
          
          const t = await Player.findOne({ username: targetName });
          if (!t) return socket.emit('message', { text: 'Target offline.', type: 'error' });

          let p = await Player.findOne({ username: user });
          // Cooldown check (60s)
          if (Date.now() - p.lastHack < 60000) return socket.emit('message', { text: 'Hack Cooldown Active.', type: 'warning' });

          // Init Hack
          const pin = generatePin(t.securityLevel);
          ACTIVE_HACKS[user] = { target: targetName, pin, attempts: 6, known: Array(pin.length).fill('*'), expires: Date.now() + 45000 };
          
          socket.emit('message', { text: `BREACH STARTED on ${targetName}.\nPIN: [ ${Array(pin.length).fill('*').join(' ')} ]\nType: guess [pin]`, type: 'special' });
          socket.emit('play_sound', 'login');
          break;
        }

        case 'guess': {
          const session = ACTIVE_HACKS[user];
          if (!session) return socket.emit('message', { text: 'No active breach.', type: 'error' });
          
          const val = args[0];
          if (!val || val.length !== session.pin.length) return socket.emit('message', { text: `Invalid PIN length (${session.pin.length}).`, type: 'error' });

          if (val === session.pin) {
            // Success
            delete ACTIVE_HACKS[user];
            let p = await Player.findOne({ username: user });
            let t = await Player.findOne({ username: session.target });
            
            const stolen = Math.floor(t.balance * 0.25);
            t.balance -= stolen; p.balance += stolen;
            p.lastHack = Date.now();
            
            await t.save(); await p.save();
            socket.emit('player_data', p);
            socket.emit('message', { text: `ACCESS GRANTED. Stole ${stolen} ODZ.`, type: 'success' });
            socket.emit('play_sound', 'success');
          } else {
            // Fail
            session.attempts--;
            if (session.attempts <= 0) {
              delete ACTIVE_HACKS[user];
              socket.emit('message', { text: 'LOCKOUT. Connection severed.', type: 'error' });
              return;
            }
            // Hints
            const diff = Math.abs(parseInt(val) - parseInt(session.pin));
            let hint = diff <= 20 ? "HOT" : (diff <= 50 ? "WARM" : "COLD");
            const dir = val < session.pin ? "(Higher)" : "(Lower)";
            socket.emit('message', { text: `Incorrect. Signal: ${hint} ${dir}. Tries: ${session.attempts}`, type: 'warning' });
          }
          break;
        }

        // --- SYSTEM ---
        case 'leaderboard': {
          const top = await Player.find().sort({ balance: -1 }).limit(5);
          socket.emit('message', { text: `\nTOP HACKERS:\n${top.map((p,i)=>`#${i+1} ${p.username} | ${p.balance}`).join('\n')}`, type: 'info' });
          break;
        }
        
        case 'status':
        case 'whoami': {
           if(!user) return;
           const p = await Player.findOne({ username: user });
           socket.emit('player_data', p); // Refresh
           break;
        }

        default:
          socket.emit('message', { text: `Unknown command: ${command}`, type: 'error' });
      }
    } catch (e) {
      console.error(e);
      socket.emit('message', { text: 'System Error.', type: 'error' });
    }
  });
});

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
