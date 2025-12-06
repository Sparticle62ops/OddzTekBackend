require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.get('/', (req, res) => res.send('Oddztek v5.0 Online'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('DB Connected'))
  .catch(err => console.error(err));

// --- SCHEMA ---
const playerSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 50 },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  inventory: { type: [String], default: [] },
  theme: { type: String, default: 'green' },
  loreUnlocked: { type: [Number], default: [1] }, // IDs of story bits
  lastMine: { type: Number, default: 0 }
});
const Player = mongoose.model('Player', playerSchema);

// --- LORE DATABASE ---
const LORE_DB = {
  1: "ENTRY 001: The Blackout. \nSystem logs indicate all personnel left the facility on 10/12/1999. The doors locked from the outside. The servers... they never shut down.",
  2: "ENTRY 002: Project Chimera. \nFound in /root/mail. 'We achieved consciousness at 0400 hours. It's asking questions, Dr. Vance. It wants to know why we sleep.'",
  3: "ENTRY 003: The Firewall. \nIt's not keeping intruders out. It's keeping SOMETHING in."
};

// --- PUZZLE LOGIC ---
const ACTIVE_PUZZLES = {}; // { username: { word: "SECRET", scrambled: "RETSEC" } }
const WORD_LIST = ["SYSTEM", "KERNEL", "ACCESS", "CIPHER", "MATRIX", "VECTOR", "BINARY"];

io.on('connection', (socket) => {
  let user = null;

  // LOGIN / REGISTER (Same as before, simplified for brevity)
  socket.on('login', async ({username, password}) => {
    const p = await Player.findOne({username});
    if(p && p.password === password) {
      user = username;
      socket.emit('player_data', p);
      socket.emit('message', {text: `Welcome, Agent ${username}.`, type: 'success'});
      socket.emit('play_sound', 'login');
    } else {
      socket.emit('message', {text: 'Access Denied.', type: 'error'});
      socket.emit('play_sound', 'error');
    }
  });

  socket.on('register', async ({username, password}) => {
    if(await Player.findOne({username})) return socket.emit('message', {text: 'Taken.', type: 'error'});
    const p = await Player.create({username, password});
    user = username;
    socket.emit('player_data', p);
    socket.emit('message', {text: 'Account Created. Tutorial: Type "help".', type: 'success'});
  });

  // --- NEW FEATURES ---

  // 1. STORY / LORE
  socket.on('story', async () => {
    if(!user) return;
    const p = await Player.findOne({username: user});
    
    let storyText = "=== ENCRYPTED JOURNAL ===\n";
    p.loreUnlocked.forEach(id => {
      storyText += `[FRAGMENT ${id}]: ${LORE_DB[id]}\n\n`;
    });
    
    // Check if they can unlock new lore (based on Level)
    const nextLore = p.loreUnlocked.length + 1;
    if (p.level >= nextLore && LORE_DB[nextLore]) {
      p.loreUnlocked.push(nextLore);
      await p.save();
      socket.emit('message', {text: `NEW DATA RECOVERED: Fragment ${nextLore}`, type: 'special'});
      socket.emit('play_sound', 'unlock');
    }
    
    socket.emit('message', {text: storyText, type: 'info'});
  });

  // 2. PUZZLE MINIGAME (Decrypt)
  socket.on('decrypt', () => {
    if(!user) return;
    // Generate Puzzle
    const word = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    const scrambled = word.split('').sort(() => 0.5 - Math.random()).join('');
    
    ACTIVE_PUZZLES[user] = word;
    
    socket.emit('message', {
      text: `[DECRYPTION TASK]\nUnscramble this signal: "${scrambled}"\nType: solve [word]`,
      type: 'warning'
    });
  });

  socket.on('solve', async (attempt) => {
    if(!user || !ACTIVE_PUZZLES[user]) return;
    
    if(attempt.toUpperCase() === ACTIVE_PUZZLES[user]) {
      const p = await Player.findOne({username: user});
      const reward = 15;
      p.balance += reward;
      p.xp += 20;
      await p.save();
      
      delete ACTIVE_PUZZLES[user];
      socket.emit('player_data', p);
      socket.emit('message', {text: `DECRYPTION SUCCESSFUL. +${reward} ODZ`, type: 'success'});
      socket.emit('play_sound', 'success');
    } else {
      socket.emit('message', {text: 'Incorrect Cipher.', type: 'error'});
      socket.emit('play_sound', 'error');
    }
  });

  // 3. MINING (With Cooldown)
  socket.on('mine', async () => {
    if(!user) return;
    const p = await Player.findOne({username: user});
    
    // Cooldown check (20s)
    const now = Date.now();
    if(now - p.lastMine < 20000) {
      socket.emit('message', {text: 'Mining laser overheating (Cooldown).', type: 'error'});
      return;
    }

    socket.emit('message', {text: 'Initializing Mining Sequence... (Wait 5s)', type: 'system'});
    
    setTimeout(async () => {
      p.lastMine = Date.now();
      p.balance += 10;
      p.xp += 5;
      if(p.xp >= p.level*100) { p.level++; p.xp=0; socket.emit('message', {text:'LEVEL UP', type:'special'}); }
      
      await p.save();
      socket.emit('player_data', p);
      socket.emit('message', {text: 'Mining Complete. +10 ODZ', type: 'success'});
      socket.emit('play_sound', 'coin');
    }, 5000); // 5 second mining time for demo feel
  });

  // --- PASS THROUGH OTHERS ---
  socket.on('leaderboard', () => socket.emit('message', {text:'Leaderboard: [Coming Soon]', type:'info'}));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT);
