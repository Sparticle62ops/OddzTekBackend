require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

// --- IMPORTS ---
// We will update commands.js next to link everything
const { handleSystem } = require('./game/commands');

// --- CONFIG ---
const PORT = process.env.PORT || 3000;

// --- SERVER SETUP ---
const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v14.0 [Dashboard] Backend Online'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- DATABASE ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('>> MongoDB Connected'))
  .catch(err => console.error('>> DB Error:', err));

// --- PLAYER SCHEMA (v14.0) ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  token: { type: String },
  balance: { type: Number, default: 100 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  theme: { type: String, default: 'green' },
  
  // Hardware
  hardware: {
    cpu: { type: Number, default: 1 },     // Mining Multiplier
    gpu: { type: Number, default: 0 },     // Hacking Speed / Hashrate
    ram: { type: Number, default: 8 },     // Exploit Capacity
    storage: { type: Number, default: 10 },// File Limit
    servers: { type: Number, default: 0 }  // Passive Income Units
  },
  
  // Security
  security: {
    firewall: { type: Number, default: 1 },
    honeypot: { type: Boolean, default: false }
  },
  
  // Inventory & State
  inventory: { type: [String], default: [] }, 
  
  // Social
  inviteCode: { type: String, default: () => Math.random().toString(36).substring(7) },
  invitedBy: { type: String, default: null },
  inbox: { type: [{ from: String, msg: String, read: Boolean, date: { type: Date, default: Date.now } }], default: [] },

  // Timers
  lastMine: { type: Number, default: 0 },
  lastHack: { type: Number, default: 0 },
  lastDaily: { type: Number, default: 0 },
  lastCollection: { type: Number, default: 0 }, // NEW: For server rack income
  
  // File System & Mission State
  files: { type: [String], default: ['readme.txt'] },
  missionProgress: { type: Object, default: {} } // Renamed from 'mission' for consistency with previous files
});

const Player = mongoose.model('Player', playerSchema);

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
  let user = null;

  // 1. AUTHENTICATION
  socket.on('auth_token', async (token) => {
    try {
      const p = await Player.findOne({ token });
      if (p) {
        user = p.username;
        socket.emit('player_data', p);
        socket.emit('message', { text: `Session Restored: ${p.username}`, type: 'success' });
        const unread = p.inbox.filter(m => !m.read).length;
        if(unread > 0) socket.emit('message', { text: `[!] ${unread} Unread Messages`, type: 'special' });
        socket.emit('play_sound', 'login');
      } else socket.emit('message', { text: 'Session Expired. Login required.', type: 'error' });
    } catch (e) { console.error(e); }
  });

  // 2. UNIFIED COMMAND HANDLER
  socket.on('cmd', async ({ command, args }) => {
    try {
      // -- AUTH COMMANDS --
      if (command === 'login') {
          const [u, p_pass] = args;
          if (!u || !p_pass) return socket.emit('message', { text: 'Usage: login [user] [pass]', type: 'error' });
          const p = await Player.findOne({ username: u });
          if (!p || p.password !== p_pass) return socket.emit('message', { text: 'Access Denied.', type: 'error' });
          
          const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
          p.token = token; await p.save();
          user = u;
          socket.emit('player_data', p);
          socket.emit('message', { text: `Welcome, Agent ${u}.`, type: 'success' });
          socket.emit('play_sound', 'login');
          return;
      }

      if (command === 'register') {
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
          return;
      }
      
      // -- LOGGED IN COMMANDS --
      if (!user) {
          socket.emit('message', { text: 'Login Required.', type: 'error' });
          return;
      }
      
      // Delegate to Module
      await handleSystem(user, command, args, socket, Player, io);

    } catch (e) {
      console.error(e);
      socket.emit('message', { text: 'System Error.', type: 'error' });
    }
  });

  socket.on('disconnect', () => { /* Cleanup if needed */ });
});

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
