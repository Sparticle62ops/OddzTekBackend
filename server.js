require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken'); 

// --- CONFIGURATION ---
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "default_secret_key"; // In prod, use .env

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v10.1 [STABLE] Backend Online'));

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
  token: { type: String }, // For session persistence
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
  
  // Social
  inviteCode: { type: String, default: () => Math.random().toString(36).substring(7) },
  invitedBy: { type: String, default: null },
  inbox: { type: [{ from: String, msg: String, read: Boolean, date: { type: Date, default: Date.now } }], default: [] },

  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  
  // File System
  files: { type: [String], default: ['readme.txt'] } 
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
const ACTIVE_HACKS = {}; // { user: { target, pin, attempts, expires, known: [] } }

// --- SHOP CATALOG ---
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

// --- LORE ---
const LORE_DB = {
  'readme.txt': "Welcome to Oddztek OS. This system is monitored. Unauthorized access is prohibited.",
  'server_log_01.txt': "FATAL ERROR 10-12-99: Core temperature critical. Automatic shutdown failed.",
  'email_archive.txt': "Subject: It's awake.\nWe can't stop the process. It has locked us out of the mainframe.",
  'blueprint_omega.dat': "Project Omega: Autonomous Digital Currency Generation. Status: UNCONTROLLED EXPANSION."
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
          
          const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
          p.token = token;
          await p.save();
          user = u;
          socket.emit('player_data', p);
          socket.emit('message', { text: `Welcome, Agent ${u}.`, type: 'success' });
          if (p.inbox.filter(m => !m.read).length > 0) socket.emit('message', { text: `[!] Unread Messages.`, type: 'special' });
          socket.emit('play_sound', 'login');
          break;
        }

        case 'register': {
          const [u, p_pass, code] = args;
          if (!u || !p_pass) return socket.emit('message', { text: 'Usage: register [user] [pass]', type: 'error' });
          if (await Player.findOne({ username: u })) return socket.emit('message', { text: 'Username taken.', type: 'error' });
          const newP = new Player({ username: u, password: p_pass });
          if (code) {
             const ref = await Player.findOne({ inviteCode: code });
             if(ref) { ref.balance+=200; newP.balance+=100; newP.invitedBy=ref.username; await ref.save(); }
          }
          await newP.save();
          user = u;
          socket.emit('player_data', newP);
          socket.emit('message', { text: 'Account Created.', type: 'success' });
          break;
        }
        
        case 'invite': {
            if(!user) return;
            const p = await Player.findOne({ username: user });
            socket.emit('message', { text: `YOUR CODE: ${p.inviteCode}`, type: 'special' });
            break;
        }

        // --- ECONOMY ---
        case 'mine': {
          if (!user || ACTIVE_MINERS.has(user)) return;
          let p = await Player.findOne({ username: user });
          const now = Date.now();
          const cd = getCooldown(p);
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
              if (p.xp >= p.level * LEVEL_XP_REQ) { p.level++; p.xp=0; socket.emit('message', { text: 'LEVEL UP!', type: 'special' }); }
              await p.save();
              socket.emit('player_data', p);
              socket.emit('message', { text: 'Mining Complete.', type: 'info' });
            }
          }, 5000);
          break;
        }

        case 'daily': {
            if (!user) return;
            let p = await Player.findOne({ username: user });
            if (Date.now() - p.lastDaily < 86400000) return socket.emit('message', { text: 'Already claimed today.', type: 'error' });
            let reward = 100 * p.level;
            const top5 = await Player.find().sort({ balance: -1 }).limit(5);
            if (top5.some(x => x.username === user)) { reward += 500; socket.emit('message', { text: 'ELITE BONUS: +500', type: 'special' }); }
            p.balance += reward; p.lastDaily = Date.now();
            await p.save();
            socket.emit('player_data', p);
            socket.emit('message', { text: `Daily: +${reward} ODZ`, type: 'success' });
            break;
        }

        // --- SHOP & INVENTORY ---
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

          const count = p.inventory.filter(i => i === id).length;
          if (item.type !== 'upgrade' && item.type !== 'skin' && count >= 2) return socket.emit('message', { text: 'Inventory Limit (2).', type: 'error' });

          p.balance -= item.price;
          if (item.type === 'skin') p.theme = item.val;
          else if (item.type === 'upgrade') {
              if (p[item.stat] >= item.val) return socket.emit('message', { text: 'Already owned.', type: 'error' });
              p[item.stat] = item.val;
          } else p.inventory.push(id);

          await p.save();
          socket.emit('player_data', p);
          socket.emit('message', { text: `Purchased: ${id}`, type: 'success' });
          socket.emit('play_sound', 'success');
          break;
        }
        
        case 'inv':
        case 'inventory': {
          if (!user) return;
          const p = await Player.findOne({ username: user });
          socket.emit('message', { text: `INVENTORY: ${p.inventory.join(', ') || 'Empty'}`, type: 'info' });
          break;
        }

        // --- HACKING ---
        case 'scan': {
            if (!user) return;
            const t = await Player.findOne({ username: args[0] });
            if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
            socket.emit('message', { text: `SCAN [${t.username}]:\nLvl: ${t.level} | Firewall: v${t.securityLevel}.0`, type: 'system' });
            break;
        }

        case 'hack': {
          if (!user) return;
          const targetName = args[0];
          if (!targetName || targetName === user) return socket.emit('message', { text: 'Invalid Target.', type: 'error' });
          const t = await Player.findOne({ username: targetName });
          if (!t) return socket.emit('message', { text: 'Target offline.', type: 'error' });

          let p = await Player.findOne({ username: user });
          if (Date.now() - p.lastHack < HACK_COOLDOWN) return socket.emit('message', { text: 'Hack Cooldown Active.', type: 'warning' });

          if (t.activeHoneypot) {
              const fine = Math.floor(p.balance * 0.5);
              p.balance -= fine; t.activeHoneypot = false; t.balance += fine;
              await p.save(); await t.save();
              socket.emit('player_data', p);
              socket.emit('message', { text: `TRAP DETECTED! Lost ${fine} ODZ!`, type: 'error' });
              socket.emit('play_sound', 'error');
              return;
          }

          const pin = generatePin(t.securityLevel);
          let known = Array(pin.length).fill('*');
          let extra = "";
          if (p.inventory.includes('decryptor_v1')) {
              const idx = Math.floor(Math.random() * pin.length);
              known[idx] = pin[idx];
              extra = `\n[DECRYPTOR] Revealed digit at ${idx+1}`;
          }

          ACTIVE_HACKS[user] = { target: targetName, pin, attempts: 6, known, expires: Date.now() + 45000 };
          socket.emit('message', { text: `BREACH STARTED on ${targetName}.\nPIN: [ ${known.join(' ')} ]${extra}\nType: guess [pin]`, type: 'special' });
          socket.emit('play_sound', 'login');
          break;
        }

        case 'guess': {
          const session = ACTIVE_HACKS[user];
          if (!session) return socket.emit('message', { text: 'No active breach.', type: 'error' });
          
          const val = args[0];
          if (!val || val.length !== session.pin.length) return socket.emit('message', { text: `Invalid PIN length (${session.pin.length}).`, type: 'error' });

          if (val === session.pin) {
            delete ACTIVE_HACKS[user];
            let p = await Player.findOne({ username: user });
            let t = await Player.findOne({ username: session.target });
            const stolen = Math.floor(t.balance * 0.25);
            t.balance -= stolen; p.balance += stolen; p.lastHack = Date.now(); p.xp += 50;
            
            if (Math.random() > 0.8) {
               const secretFile = 'server_log_01.txt';
               if (!p.files.includes(secretFile)) { p.files.push(secretFile); socket.emit('message', { text: `DATA RECOVERED: ${secretFile}`, type: 'special' }); }
            }

            await t.save(); await p.save();
            socket.emit('player_data', p);
            socket.emit('message', { text: `ACCESS GRANTED. Stole ${stolen} ODZ.`, type: 'success' });
            socket.emit('play_sound', 'success');
          } else {
            session.attempts--;
            if (session.attempts <= 0) {
              delete ACTIVE_HACKS[user];
              socket.emit('message', { text: 'LOCKOUT. Connection severed.', type: 'error' });
              return;
            }
            
            let matched = false;
            for(let i=0; i<session.pin.length; i++) {
                if(val[i] === session.pin[i] && session.known[i] === '*') { session.known[i] = val[i]; matched = true; }
            }

            const diff = Math.abs(parseInt(val) - parseInt(session.pin));
            let hint = diff <= 20 ? "HOT" : (diff <= 50 ? "WARM" : "COLD");
            const dir = val < session.pin ? "(Higher)" : "(Lower)";
            let msg = `Incorrect. Signal: ${hint} ${dir}.`;
            if(matched) msg += `\n[!] DIGIT MATCHED! PIN: [ ${session.known.join(' ')} ]`;
            msg += `\nTries: ${session.attempts}`;
            socket.emit('message', { text: msg, type: 'warning' });
          }
          break;
        }
        
        case 'brute': {
            if (!ACTIVE_HACKS[user] || ACTIVE_HACKS[user].target !== args[0]) return socket.emit('message', { text: 'No active breach.', type: 'error' });
            let p = await Player.findOne({ username: user });
            if (!p.inventory.includes('brute_force_v1')) return socket.emit('message', { text: 'Tool missing.', type: 'error' });
            
            p.inventory.splice(p.inventory.indexOf('brute_force_v1'), 1);
            await p.save();
            
            const s = ACTIVE_HACKS[user];
            const unknown = s.known.map((v, i) => v === '*' ? i : -1).filter(i => i !== -1);
            if (unknown.length > 0) {
                const k = unknown[Math.floor(Math.random() * unknown.length)];
                s.known[k] = s.pin[k];
                socket.emit('message', { text: `[BRUTE] Cracked digit ${k+1}: ${s.pin[k]}`, type: 'special' });
                socket.emit('message', { text: `PIN: [ ${s.known.join(' ')} ]`, type: 'info' });
                socket.emit('player_data', p);
            }
            break;
        }

        // --- SYSTEM ---
        case 'theme': {
          const themeName = args[0];
          if (!user) return;
          if (['green','amber','plasma','matrix'].includes(themeName)) {
              let p = await Player.findOne({ username: user });
              if (themeName !== 'green' && !p.inventory.includes(`theme_${themeName}`)) {
                  return socket.emit('message', { text: 'Theme locked. Buy in shop.', type: 'error' });
              }
              p.theme = themeName;
              await p.save();
              socket.emit('player_data', p);
              socket.emit('message', { text: `Theme set: ${themeName}`, type: 'success' });
          } else {
              socket.emit('message', { text: 'Invalid theme.', type: 'error' });
          }
          break;
        }

        case 'chat': {
          const msg = args.join(' ');
          if (!user) return;
          if (!msg) return socket.emit('message', { text: 'Usage: chat [msg]', type: 'error' });
          io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
          break;
        }

        case 'files': {
          if (!user) return;
          const p = await Player.findOne({ username: user });
          socket.emit('message', { text: `\n/ROOT:\n${p.files.join('\n')}`, type: 'info' });
          break;
        }

        case 'read': {
          const file = args[0];
          if (!user) return;
          const p = await Player.findOne({ username: user });
          if (p.files.includes(file) && LORE_DB[file]) {
            socket.emit('message', { text: `\n> ${file}\n${LORE_DB[file]}`, type: 'system' });
          } else socket.emit('message', { text: 'File corrupted/missing.', type: 'error' });
          break;
        }

        case 'mail': {
          const action = args[0];
          if (!user) return;
          let p = await Player.findOne({ username: user });

          if (action === 'check') {
             if (!p.inbox.length) socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
             else socket.emit('message', { text: `\n=== INBOX ===\n${p.inbox.map((m,i)=>`[${i+1}] ${m.read ? '(Read)' : '(NEW)'} From: ${m.from} | "${m.msg}"`).join('\n')}`, type: 'info' });
          } 
          else if (action === 'send') {
             const target = args[1];
             const msg = args.slice(2).join(' ');
             if(!target || !msg) return socket.emit('message', { text: 'Usage: mail send [user] [msg]', type: 'error' });
             const t = await Player.findOne({ username: target });
             if (!t) return socket.emit('message', { text: 'User not found.', type: 'error' });
             t.inbox.push({ from: user, msg: msg, read: false, date: new Date() });
             await t.save();
             socket.emit('message', { text: 'Message Sent.', type: 'success' });
          }
          else if (action === 'read') {
             const idx = parseInt(args[1]) - 1;
             if (p.inbox[idx]) {
                 p.inbox[idx].read = true;
                 await p.save();
                 socket.emit('message', { text: 'Marked as read.', type: 'success' });
             } else socket.emit('message', { text: 'Invalid ID.', type: 'error' });
          }
          else socket.emit('message', { text: 'Usage: mail check | mail send', type: 'error' });
          break;
        }
        
        case 'transfer': {
            const target = args[0];
            const amount = parseInt(args[1]);
            if (!user) return;
            if (isNaN(amount) || amount <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
            let p = await Player.findOne({ username: user });
            if (p.balance < amount) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
            const t = await Player.findOne({ username: target });
            if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });

            p.balance -= amount; t.balance += amount;
            t.inbox.push({ from: 'SYSTEM', msg: `Received ${amount} ODZ from ${user}.`, read: false });
            
            await p.save(); await t.save();
            socket.emit('player_data', p);
            socket.emit('message', { text: `Transferred ${amount} ODZ to ${target}.`, type: 'success' });
            break;
        }
        
        case 'flip': {
            const side = args[0];
            const amount = parseInt(args[1]);
            if (!user) return;
            if (isNaN(amount) || amount <= 0) return socket.emit('message', { text: 'Invalid amount.', type: 'error' });
            if (!['heads', 'tails'].includes(side.toLowerCase())) return socket.emit('message', { text: 'Choose heads or tails.', type: 'error' });

            let p = await Player.findOne({ username: user });
            if (p.balance < amount) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });

            const result = Math.random() > 0.5 ? 'heads' : 'tails';
            const win = (side.toLowerCase() === result);
            
            if(win) {
                p.balance += amount; p.winsFlip++;
                socket.emit('message', { text: `Result: ${result.toUpperCase()}. YOU WON +${amount} ODZ!`, type: 'success' });
                socket.emit('play_sound', 'success');
            } else {
                p.balance -= amount; p.lossesFlip++;
                socket.emit('message', { text: `Result: ${result.toUpperCase()}. You lost ${amount} ODZ.`, type: 'error' });
                socket.emit('play_sound', 'error');
            }
            await p.save();
            socket.emit('player_data', p);
            break;
        }

        case 'leaderboard': {
          const all = await Player.find();
          const visible = all.filter(p => !p.inventory.includes('cloak_v1'));
          const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
          socket.emit('message', { text: `\n=== TOP HACKERS ===\n${top.map((p,i)=>`#${i+1} ${p.username} | ${p.balance}`).join('\n')}`, type: 'info' });
          break;
        }
        
        case 'status':
        case 'whoami': {
           if(!user) return;
           const p = await Player.findOne({ username: user });
           socket.emit('player_data', p);
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
