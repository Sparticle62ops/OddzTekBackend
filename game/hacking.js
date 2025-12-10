// game/hacking.js
const { PORTS, HACK_COOLDOWN, LOOT } = require('./constants');

// Session Store
const SESSIONS = {}; 
// PvP Active Hacks Store (Legacy/Direct)
const ACTIVE_HACKS = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateFiles(diff, isPlayer) {
    const files = {};
    if (Math.random() > 0.5) files['user_data.txt'] = "Regular User Data";
    
    // Players ALWAYS have a wallet
    if (isPlayer) {
        files['wallet.dat'] = "LOCKED_ASSET";
    } else {
        // NPCs have chance based on diff
        if (diff >= 3 && Math.random() > 0.7) files['wallet.dat'] = "LOCKED_ASSET";
    }
    
    if (diff >= 4) files['sys_core.log'] = "ROOT ACCESS LOG";
    return files;
}

function generateSystem(diff, isPlayer) {
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

    return { 
        ip, os, 
        ports: openPorts, 
        files: generateFiles(diff, isPlayer) 
    };
}

function generatePin(level) {
    const len = level <= 1 ? 3 : (level === 2 ? 4 : 5);
    let pin = '';
    for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
    return pin;
}

// ========================================================
// 1. RECON & SCANNING
// ========================================================
async function handleNetScan(user, socket, Player) {
    socket.emit('message', { text: "Scanning subnet...", type: 'loading' });
    await delay(1500);

    const players = await Player.find({ username: { $ne: user } }).select('username security.firewall').limit(3);
    const npcNames = ['Global_Bank', 'Omega_Server', 'Dark_Relay'];
    
    let msg = "\n=== ACTIVE TARGETS ===\n";
    players.forEach(pl => {
        msg += `IP: 192.168.X.X  | USER: ${pl.username.padEnd(12)} | FW: v${pl.security.firewall}\n`;
    });
    const npc = npcNames[Math.floor(Math.random()*npcNames.length)];
    msg += `IP: 10.0.0.${Math.floor(Math.random()*99)}   | USER: ${npc.padEnd(12)} | FW: v${Math.floor(Math.random()*3)+1} (NPC)\n`;
    
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleScan(user, args, socket, Player) {
    const target = args[0];
    if (!target) return socket.emit('message', { text: 'Usage: scan [ip/user]', type: 'error' });

    let t = await Player.findOne({ username: target });
    let diff = 1;
    let isPlayer = false;

    if (t) {
        diff = t.security.firewall; 
        isPlayer = true;
    } else {
        diff = Math.floor(Math.random() * 5) + 1;
    }

    socket.emit('message', { text: `Scanning ${target}...`, type: 'loading' });
    await delay(2000);

    const sys = generateSystem(diff, isPlayer);
    SESSIONS[user] = { target: target, sys: sys, stage: 'recon', accessLevel: 'none', isTargetPlayer: isPlayer };

    let msg = `\nSCAN COMPLETE: ${sys.ip} (${sys.os})\nPORTS:\n`;
    sys.ports.forEach(p => msg += `[${p.port}] ${p.service} (Vuln: ${p.type})\n`);
    msg += `\nType 'exploit [port]' to attach.`;

    socket.emit('message', { text: msg, type: 'success' });
}

// ========================================================
// 2. EXPLOIT & SHELL (PvE / Detailed Hacking)
// ========================================================
async function handleExploit(user, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session) return socket.emit('message', { text: 'No active target. Scan first.', type: 'error' });
    
    const port = args[0];
    const targetPort = session.sys.ports.find(p => p.port == port);

    if (!targetPort) return socket.emit('message', { text: `Port ${port} is closed.`, type: 'error' });

    let p = await Player.findOne({ username: user });
    
    if (targetPort.diff > 2 && p.hardware.ram < 8) {
         return socket.emit('message', { text: `Insufficient RAM. Need upgrade for Port ${port}.`, type: 'error' });
    }

    socket.emit('message', { text: `Running ${targetPort.type}...`, type: 'loading' });
    await delay(2000);

    const baseChance = 0.5;
    const gpuBonus = (p.hardware.gpu || 0) * 0.1; 
    const chance = baseChance + gpuBonus;

    // Small chance to fail
    if (Math.random() < chance) {
        session.stage = 'shell';
        session.accessLevel = 'user';
        socket.emit('message', { text: `ACCESS GRANTED.\nShell Connected (User Level).\nType 'ls', 'cat', or 'privesc'.`, type: 'success' });
    } else {
        socket.emit('message', { text: 'Exploit Failed. Connection Reset.', type: 'error' });
        delete SESSIONS[user];
    }
}

// --- 4. SHELL INTERCEPT & WALLET CRACKING ---
async function handleShell(user, cmd, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session || session.stage !== 'shell') return false; 

    // --- WALLET CRACK MINIGAME INTERCEPT ---
    // This runs if the user is currently trying to crack a wallet
    if (session.walletChallenge) {
        if (cmd === 'unlock' || cmd === 'guess') {
            const guessStr = args[0];
            const guess = parseInt(guessStr);
            if (isNaN(guess)) { socket.emit('message', { text: "Usage: unlock [number]", type: 'error' }); return true; }

            const targetPinStr = session.walletChallenge.pin.toString();
            
            if (guess === session.walletChallenge.pin) {
                // WIN
                socket.emit('message', { text: "KEY ACCEPTED.", type: 'success' });
                await delay(1000);
                await payoutLoot(user, socket, Player, session);
                session.walletChallenge = null;
            } else {
                // FAIL HINTS
                session.walletChallenge.tries--;
                if (session.walletChallenge.tries <= 0) {
                    socket.emit('message', { text: "ENCRYPTION SEALED. File destroyed.", type: 'error' });
                    delete SESSIONS[user]; // Kick player
                    return true;
                }

                // --- LOGIC: DIGIT REVEAL FOR WALLET ---
                let revealed = false;
                // Pad pin specific to this challenge level (usually 3 digits: 100-999)
                const pinStr = session.walletChallenge.pin.toString();
                const guessS = guess.toString().padStart(3, '0');

                for (let i = 0; i < 3; i++) {
                    if (guessS[i] && guessS[i] === pinStr[i] && session.walletChallenge.known[i] === '*') {
                        session.walletChallenge.known[i] = pinStr[i];
                        revealed = true;
                    }
                }

                const dir = guess < session.walletChallenge.pin ? "(Higher)" : "(Lower)";
                let msg = `INVALID KEY. Signal: ${dir}`;
                if (revealed) msg += `\n[+] DIGIT MATCHED!`;
                msg += `\nCURRENT KEY STATE: [ ${session.walletChallenge.known.join(' ')} ]`;
                msg += `\nAttempts: ${session.walletChallenge.tries}`;

                socket.emit('message', { text: msg, type: 'warning' });
            }
            return true;
        } else if (cmd === 'exit') {
            session.walletChallenge = null;
            socket.emit('message', { text: "Crack aborted.", type: 'info' });
            return true;
        } else {
            socket.emit('message', { text: `[SECURE INPUT] Type 'unlock [number]' to proceed.`, type: 'warning' });
            return true; // Block other commands
        }
    }

    // --- STANDARD SHELL COMMANDS ---
    if (cmd === 'ls') {
        const files = Object.keys(session.sys.files);
        socket.emit('message', { text: files.length ? files.join('\n') : 'No readable files.', type: 'info' });
        return true;
    }

    if (cmd === 'privesc') {
        let p = await Player.findOne({ username: user });
        if (p.hardware.gpu < 1) { socket.emit('message', { text: 'GPU Required used for brute-force escalation.', type: 'error' }); return true; }
        
        socket.emit('message', { text: 'Escalating...', type: 'loading' });
        await delay(2000);
        if (Math.random() > 0.4) {
            session.accessLevel = 'root';
            socket.emit('message', { text: '# ROOT ACCESS GRANTED #', type: 'special' });
        } else socket.emit('message', { text: 'Escalation Failed.', type: 'error' });
        return true;
    }

    if (cmd === 'cat' || cmd === 'download') {
        const file = args[0];
        if (!session.sys.files[file]) { socket.emit('message', { text: 'File not found.', type: 'error' }); return true; }

        // --- WALLET TRIGGER ---
        if (file === 'wallet.dat') {
            // REMOVED 'Root' check requirement to make it accessible via minigame
            // Or keep it? Let's make it so you can try to crack it immediately!
            
            // INIT WALLET CHALLENGE
            const pin = Math.floor(Math.random() * 900) + 100; // 3 digits
            session.walletChallenge = { 
                pin: pin, 
                tries: 5,
                known: ['*', '*', '*'] // Track revealed digits here
            };
            
            socket.emit('message', { text: `[ENCRYPTION DETECTED]\nCrack 3-digit key.\nType 'unlock [number]'.`, type: 'special' });
            return true;
        }

        socket.emit('message', { text: `Downloading ${file}...`, type: 'loading' });
        await delay(1000);
        
        let p = await Player.findOne({ username: user });
        if (!p.files.includes(file)) p.files.push(file); 
        await p.save();
        socket.emit('message', { text: `File saved to local storage.`, type: 'success' });
        return true;
    }

    if (cmd === 'exit') {
        delete SESSIONS[user];
        socket.emit('message', { text: 'Disconnected.', type: 'info' });
        return true;
    }

    return false;
}

// --- PAYOUT HELPER (REAL PVP STEALING) ---
async function payoutLoot(user, socket, Player, session) {
    let p = await Player.findOne({ username: user });
    let stolen = 0;
    
    if (session.isTargetPlayer && session.target) {
        const t = await Player.findOne({ username: session.target });
        if (t) {
            // Steal percentage
            const percent = 0.25; 
            stolen = Math.floor(t.balance * percent);
            if (stolen > 0) {
                t.balance -= stolen;
                t.inbox.push({ from: 'SYSTEM', msg: `ALERT: Wallet cracked by ${user}. Lost ${stolen} ODZ` });
                await t.save();
            }
        }
    } else {
        stolen = Math.floor(Math.random() * 800) + 400;
    }
    
    p.balance += stolen;
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `TRANSFERRED: +${stolen} ODZ`, type: 'success' });
    socket.emit('play_sound', 'coin');
    delete SESSIONS[user];
}

// Keep the PvP direct methods just in case `hack` is called directly, 
// though we encourage scan/exploit/shell/crack flow.
async function handleHackInit(user, args, socket, Player) {
    socket.emit('message', { text: "Legacy Protocol. Use 'scan [target]' -> 'exploit 80' -> 'cat wallet.dat' to crack.", type: 'info' });
}
// Placeholder to satisfy exports
async function handleGuess() {}; 
async function handleBrute() {};

module.exports = { handleNetScan, handleScan, handleExploit, handleShell, handleHackInit, handleGuess, handleBrute };
