// game/hacking.js
const { PORTS, HACK_COOLDOWN, LOOT } = require('./constants');

// --- STATE MANAGEMENT ---
// SESSIONS = For PvE/NPC Port Hacking (Exploit/Shell)
// ACTIVE_HACKS = For PvP PIN Cracking (The OG Method)
const SESSIONS = {}; 
const ACTIVE_HACKS = {}; 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- HELPERS ---
function generateFiles(diff) {
    const files = {};
    if (Math.random() > 0.5) files['user_data.txt'] = "Regular User Data";
    if (diff >= 3 && Math.random() > 0.7) files['wallet.dat'] = "ENCRYPTED_WALLET";
    if (diff >= 4) files['sys_core.log'] = "ROOT ACCESS LOG";
    return files;
}

function generateSystem(diff) {
    const ip = `192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
    const os = Math.random() > 0.5 ? 'Linux (Ubuntu)' : 'Windows Server 2019';
    const openPorts = [];
    const portKeys = Object.keys(PORTS);
    
    let count = Math.max(1, 5 - diff); 
    if (diff === 1) count = 4; 
    
    for(let i=0; i<count; i++) {
        const p = portKeys[Math.floor(Math.random() * portKeys.length)];
        if (!openPorts.find(x => x.port == p)) {
            openPorts.push({ port: parseInt(p), ...PORTS[p] });
        }
    }
    if (openPorts.length === 0) openPorts.push({ port: 80, ...PORTS[80] });

    return { ip, os, ports: openPorts, files: generateFiles(diff) };
}

function generatePin(level) {
    // Level 1 = 3 digits (Easy)
    // Level 2 = 4 digits (Medium)
    // Level 3+ = 5 digits (Hard)
    const len = level <= 1 ? 3 : (level === 2 ? 4 : 5);
    let pin = '';
    for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
    return pin;
}

// ========================================================
// 1. RECONNAISSANCE (Works for both PvP and PvE)
// ========================================================
async function handleScan(user, args, socket, Player) {
    const target = args[0];
    if (!target) return socket.emit('message', { text: 'Usage: scan [ip/user]', type: 'error' });

    let t = await Player.findOne({ username: target });
    
    // PvP SCAN (Player)
    if (t) {
        socket.emit('message', { text: `Scanning user database for ${target}...`, type: 'loading' });
        await delay(1500);
        
        const fw = t.security.firewall;
        const wealth = t.balance > 2000 ? 'HIGH' : (t.balance > 500 ? 'MEDIUM' : 'LOW');
        
        let msg = `\n[TARGET ANALYZED: ${target}]\n`;
        msg += `Status: ONLINE\n`;
        msg += `Firewall Level: v${fw}.0 (PIN Length: ${fw <= 1 ? 3 : (fw === 2 ? 4 : 5)})\n`;
        msg += `Account Activity: ${wealth}\n`;
        msg += `\n>> Type 'hack ${target}' to initiate PIN Breach.`;
        
        socket.emit('message', { text: msg, type: 'success' });
        return;
    } 
    
    // PvE SCAN (NPC/IP)
    const diff = Math.floor(Math.random() * 5) + 1;
    socket.emit('message', { text: `Scanning IP ${target}...`, type: 'loading' });
    await delay(1500);

    const sys = generateSystem(diff);
    SESSIONS[user] = { target: target, sys: sys, stage: 'recon', accessLevel: 'none' }; // PvE Session

    let msg = `\nSCAN COMPLETE: ${sys.ip} (${sys.os})\nPORTS:\n`;
    sys.ports.forEach(p => msg += `[${p.port}] ${p.service} (Vuln: ${p.type})\n`);
    msg += `\nType 'exploit [port]' to attack infrastructure.`;

    socket.emit('message', { text: msg, type: 'success' });
}

// ========================================================
// 2. PvP HACKING (The OG Method: PIN Guessing)
// ========================================================
async function handleHackInit(user, args, socket, Player) {
    const targetName = args[0];
    if (!targetName || targetName === user) return socket.emit('message', { text: 'Invalid Target.', type: 'error' });

    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'User not found. Use "scan" to find valid targets.', type: 'error' });

    let p = await Player.findOne({ username: user });
    
    // Cooldown Update: 60s
    if (Date.now() - p.lastHack < HACK_COOLDOWN) {
        const wait = Math.ceil((HACK_COOLDOWN - (Date.now() - p.lastHack))/1000);
        return socket.emit('message', { text: `Hack Cooldown: ${wait}s remaining.`, type: 'warning' });
    }

    // Check Honeypot
    if (target.activeHoneypot) {
        socket.emit('message', { text: "Handshake initiated...", type: 'loading' });
        await delay(1000);
        
        const fine = Math.floor(p.balance * 0.3); // Lose 30%
        p.balance -= fine; 
        target.activeHoneypot = false; // Consumed
        target.balance += fine * 0.5; // Target gets half the fine
        
        await p.save(); await target.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: `⚠️ TRAP TRIGGERED! Honeypot drained ${fine} ODZ.`, type: 'error' });
        socket.emit('play_sound', 'error');
        return;
    }

    // Start PIN Game
    const pin = generatePin(target.security.firewall);
    // Decryptor Tool: Reveal 1 digit
    let known = Array(pin.length).fill('*');
    let extra = "";
    
    if (p.inventory.includes('decryptor_v1')) {
        const idx = Math.floor(Math.random() * pin.length);
        known[idx] = pin[idx];
        extra = `\n[TOOL] Decryptor revealed digit ${idx+1}`;
    }

    ACTIVE_HACKS[user] = { 
        target: targetName, 
        pin: pin, 
        attempts: 5, 
        known: known,
        expires: Date.now() + 45000 // 45s timer
    };

    socket.emit('message', { 
        text: `BREACH STARTED: ${targetName}\nSecurity: Level ${target.security.firewall}\nPIN: [ ${known.join(' ')} ]${extra}\n\nType 'guess [number]' to crack the code.`, 
        type: 'special' 
    });
    socket.emit('play_sound', 'login');
}

async function handleGuess(user, args, socket, Player) {
    const session = ACTIVE_HACKS[user];
    if (!session) return socket.emit('message', { text: 'No active PIN breach. Use "hack [user]" first.', type: 'error' });
    
    if (Date.now() > session.expires) { 
        delete ACTIVE_HACKS[user]; 
        return socket.emit('message', { text: 'Connection Timed Out.', type: 'error' }); 
    }
    
    const val = args[0];
    if (!val || val.length !== session.pin.length) {
        return socket.emit('message', { text: `Invalid Input. PIN is ${session.pin.length} digits.`, type: 'error' });
    }

    // --- SUCCESS ---
    if (val === session.pin) {
        delete ACTIVE_HACKS[user];
        
        const t = await Player.findOne({ username: session.target });
        const p = await Player.findOne({ username: user });
        
        // Steal 20-30% of funds
        const percent = (Math.random() * 0.1) + 0.2;
        const stolen = Math.floor(t.balance * percent);
        
        if (stolen > 0) {
            t.balance = Math.max(0, t.balance - stolen);
            p.balance += stolen;
            
            // Notify Victim
            t.inbox.push({ 
                from: 'SYSTEM', 
                msg: `SECURITY ALERT: You were hacked by ${user}. Lost ${stolen} ODZ.`,
                read: false,
                date: new Date()
            });
        }

        p.lastHack = Date.now();
        p.xp += 100;

        await t.save(); await p.save();
        
        socket.emit('player_data', p);
        socket.emit('message', { text: `ACCESS GRANTED.\nTransferring Funds...\n[SUCCESS] Stole ${stolen} ODZ from ${session.target}.`, type: 'success' });
        socket.emit('play_sound', 'coin'); // Cash sound
    } 
    // --- FAIL ---
    else {
        session.attempts--;
        if (session.attempts <= 0) {
            delete ACTIVE_HACKS[user];
            socket.emit('message', { text: 'LOCKOUT. Connection severed.', type: 'error' });
            return;
        }

        // Generate Hints
        let matched = false;
        // 1. Literal Match Updates
        for(let i=0; i<session.pin.length; i++) {
            if(val[i] === session.pin[i] && session.known[i] === '*') {
                session.known[i] = val[i];
                matched = true;
            }
        }

        // 2. High/Low & Hot/Cold Logic
        const numVal = parseInt(val);
        const numPin = parseInt(session.pin);
        const diff = Math.abs(numVal - numPin);
        
        let temp = "COLD";
        if (diff <= 10) temp = "BURNING HOT";
        else if (diff <= 50) temp = "HOT";
        else if (diff <= 200) temp = "WARM";

        const dir = numVal < numPin ? "(Higher)" : "(Lower)";
        
        let msg = `Incorrect. Signal: ${temp} ${dir}.`;
        if (matched) msg += `\n[!] DIGIT CRACKED! PIN: [ ${session.known.join(' ')} ]`;
        
        msg += `\nAttempts left: ${session.attempts}`;
        socket.emit('message', { text: msg, type: 'warning' });
    }
}

// ========================================================
// 3. PvE HACKING (Missions/NPCs - Exploit System)
// ========================================================
async function handleExploit(user, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session) return socket.emit('message', { text: 'No active scan target. Scan an IP/NPC first.', type: 'error' });
    
    // ... (This logic remains for Missions/NPCs) ...
    // Port validation
    const port = args[0];
    const targetPort = session.sys.ports.find(p => p.port == port);
    if (!targetPort) return socket.emit('message', { text: `Port ${port} is closed.`, type: 'error' });

    // Hardware Check (RAM)
    let p = await Player.findOne({ username: user });
    if (targetPort.diff > 2 && p.hardware.ram < 8) {
         return socket.emit('message', { text: `Insufficient RAM. Need upgrade for Port ${port}.`, type: 'error' });
    }

    socket.emit('message', { text: `Running ${targetPort.type} exploit...`, type: 'loading' });
    await delay(2000);

    // Chance based on GPU
    const baseChance = 0.6;
    const gpuBonus = (p.hardware.gpu || 0) * 0.1;
    if (Math.random() < (baseChance + gpuBonus)) {
        session.stage = 'shell';
        session.accessLevel = 'user';
        socket.emit('message', { text: `ROOTKIT INSTALLED.\nInteractive Shell Active.\nType 'ls', 'cat [file]', or 'exit'.`, type: 'success' });
        socket.emit('play_sound', 'success');
    } else {
        socket.emit('message', { text: 'Exploit Failed. Target patched vulnerability.', type: 'error' });
        socket.emit('play_sound', 'error');
        delete SESSIONS[user];
    }
}

async function handleShell(user, cmd, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session || session.stage !== 'shell') return false; 

    // Handle standard shell commands (ls, cat, exit)
    if (cmd === 'ls') {
        const files = Object.keys(session.sys.files);
        socket.emit('message', { text: files.join('\n'), type: 'info' });
        return true;
    }
    
    // Looting NPCs
    if (cmd === 'cat' || cmd === 'download') {
        const file = args[0];
        if (!session.sys.files[file]) {
             socket.emit('message', { text: 'File not found.', type: 'error' });
             return true;
        }
        
        socket.emit('message', { text: `Downloading ${file}...`, type: 'loading' });
        await delay(1000);

        let p = await Player.findOne({ username: user });
        // Specific Loot Logic for NPCs
        if (file === 'wallet.dat') {
             const amt = Math.floor(Math.random() * 500) + 500;
             p.balance += amt;
             socket.emit('message', { text: `Wallet Decrypted: +${amt} ODZ`, type: 'success' });
        } else {
             if (!p.files.includes(file)) p.files.push(file); 
             socket.emit('message', { text: `Data saved to local drive.`, type: 'success' });
        }
        
        await p.save();
        socket.emit('player_data', p);
        return true; // Command handled
    }

    if (cmd === 'exit') {
        delete SESSIONS[user];
        socket.emit('message', { text: 'Logged out.', type: 'info' });
        return true;
    }

    return false;
}

// NOTE: Brute Force Tool Logic (for PIN games)
async function handleBrute(user, args, socket, Player) {
    // Only works on PIN hacks
    if (!ACTIVE_HACKS[user]) return socket.emit('message', { text: 'No active PIN break in progress.', type: 'error' });
    
    let p = await Player.findOne({ username: user });
    if (!p.inventory.includes('brute_force_v1')) return socket.emit('message', { text: 'Tool missing.', type: 'error' });
    
    const idx = p.inventory.indexOf('brute_force_v1');
    p.inventory.splice(idx, 1);
    await p.save();
    
    const s = ACTIVE_HACKS[user];
    // Find an unknown digit
    const unknownIdx = s.known.findIndex(k => k === '*');
    
    if (unknownIdx !== -1) {
        s.known[unknownIdx] = s.pin[unknownIdx];
        socket.emit('message', { text: `[BRUTE FORCE] Revealed digit ${unknownIdx+1}: ${s.pin[unknownIdx]}`, type: 'special' });
        socket.emit('message', { text: `PIN: [ ${s.known.join(' ')} ]`, type: 'info' });
        socket.emit('player_data', p);
    } else {
        socket.emit('message', { text: 'PIN is already fully known.', type: 'info' });
    }
}

module.exports = { handleNetScan, handleScan, handleHackInit, handleGuess, handleExploit, handleShell, handleBrute };
