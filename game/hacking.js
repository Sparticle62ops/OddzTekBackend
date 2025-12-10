// game/hacking.js
const { PORTS, HACK_COOLDOWN, LOOT } = require('./constants');

// Session Store
const SESSIONS = {}; 
// PvP Active Hacks Store
const ACTIVE_HACKS = {};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- HELPERS ---
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
    
    // Create PvE Session
    SESSIONS[user] = { target: target, sys: sys, stage: 'recon', accessLevel: 'none', isTargetPlayer: isPlayer };

    let msg = `\nSCAN COMPLETE: ${sys.ip} (${sys.os})\nPORTS:\n`;
    sys.ports.forEach(p => msg += `[${p.port}] ${p.service} (Vuln: ${p.type})\n`);
    
    if (isPlayer) msg += `\n>> TARGET IS A PLAYER. Use 'hack ${target}' to breach directly (PvP).\n>> OR use 'exploit [port]' for stealthy file access.`;
    else msg += `\nType 'exploit [port]' to attach.`;

    socket.emit('message', { text: msg, type: 'success' });
}

// ========================================================
// 2. PvP HACKING (Direct Attack)
// ========================================================
async function handleHackInit(user, args, socket, Player) {
    const targetName = args[0];
    if (!targetName || targetName === user) return socket.emit('message', { text: 'Invalid Target.', type: 'error' });

    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'User not found. Use "netscan".', type: 'error' });

    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastHack < HACK_COOLDOWN) {
        const wait = Math.ceil((HACK_COOLDOWN - (Date.now() - p.lastHack))/1000);
        return socket.emit('message', { text: `Hack Cooldown: ${wait}s remaining.`, type: 'warning' });
    }

    if (target.activeHoneypot) {
        socket.emit('message', { text: "Handshake...", type: 'loading' });
        await delay(1000);
        const fine = Math.floor(p.balance * 0.3);
        p.balance -= fine; target.activeHoneypot = false; target.balance += fine * 0.5;
        await p.save(); await target.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: `⚠️ TRAP TRIGGERED! Lost ${fine} ODZ.`, type: 'error' });
        socket.emit('play_sound', 'error');
        return;
    }

    const pin = generatePin(target.security.firewall);
    let known = Array(pin.length).fill('*');
    let extra = "";
    
    if (p.inventory.includes('decryptor_v1')) {
        const idx = Math.floor(Math.random() * pin.length);
        known[idx] = pin[idx];
        extra = `\n[TOOL] Decryptor revealed digit ${idx+1}`;
    }

    ACTIVE_HACKS[user] = { 
        target: targetName, pin: pin, attempts: 5, known: known, expires: Date.now() + 45000 
    };

    socket.emit('message', { 
        text: `BREACH STARTED: ${targetName}\nSecurity: Level ${target.security.firewall}\nPIN: [ ${known.join(' ')} ]${extra}\n\nType 'guess [number]' to crack code.`, 
        type: 'special' 
    });
    socket.emit('play_sound', 'login');
}

async function handleGuess(user, args, socket, Player) {
    const session = ACTIVE_HACKS[user];
    if (!session) return socket.emit('message', { text: 'No active PIN breach.', type: 'error' });
    if (Date.now() > session.expires) { delete ACTIVE_HACKS[user]; return socket.emit('message', { text: 'Timed Out.', type: 'error' }); }
    
    const val = args[0];
    if (!val || val.length !== session.pin.length) {
        return socket.emit('message', { text: `Invalid Input. Length must be ${session.pin.length}.`, type: 'error' });
    }

    if (val === session.pin) {
        // WIN PvP
        delete ACTIVE_HACKS[user];
        const t = await Player.findOne({ username: session.target });
        const p = await Player.findOne({ username: user });
        
        const stolen = Math.floor(t.balance * 0.25);
        t.balance = Math.max(0, t.balance - stolen);
        p.balance += stolen;
        
        t.inbox.push({ from: 'SYSTEM', msg: `ALERT: ${user} breached your firewall! Lost ${stolen} ODZ.` });
        
        await t.save(); await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: `ACCESS GRANTED.\nTransferred: +${stolen} ODZ`, type: 'success' });
        socket.emit('play_sound', 'coin');
    } else {
        // FAIL Logic
        session.attempts--;
        if (session.attempts <= 0) {
            delete ACTIVE_HACKS[user];
            socket.emit('message', { text: 'LOCKOUT.', type: 'error' });
            return;
        }

        // --- DIGIT MATCH REVEAL LOGIC ---
        let revealedNew = false;
        for(let i=0; i<session.pin.length; i++) {
            if (val[i] === session.pin[i] && session.known[i] === '*') {
                session.known[i] = val[i]; // Lock digit
                revealedNew = true;
            }
        }

        // Hot/Cold
        const diff = Math.abs(parseInt(val) - parseInt(session.pin));
        const dir = val < session.pin ? "(Higher)" : "(Lower)";
        let hint = diff < 20 ? "HOT" : (diff < 100 ? "WARM" : "COLD");

        let msg = `Incorrect. Signal: ${hint} ${dir}.`;
        if (revealedNew) msg += `\n[+] DIGIT LOCKED!`;
        msg += `\nKNOWN PIN: [ ${session.known.join(' ')} ]`; // Explicitly show known state
        msg += `\nTries: ${session.attempts}`;
        
        socket.emit('message', { text: msg, type: 'warning' });
    }
}

// ========================================================
// 3. EXPLOIT & SHELL (PvE / Detailed Hacking)
// ========================================================
async function handleExploit(user, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session) return socket.emit('message', { text: 'Scan target first.', type: 'error' });
    
    const port = args[0];
    const targetPort = session.sys.ports.find(p => p.port == port);
    if (!targetPort) return socket.emit('message', { text: `Port ${port} closed.`, type: 'error' });

    let p = await Player.findOne({ username: user });
    if (targetPort.diff > 2 && p.hardware.ram < 8) return socket.emit('message', { text: `Insufficient RAM.`, type: 'error' });

    socket.emit('message', { text: `Exploiting ${targetPort.type}...`, type: 'loading' });
    await delay(2000);

    const chance = 0.5 + (p.hardware.gpu * 0.1);
    if (Math.random() < chance) {
        session.stage = 'shell';
        session.accessLevel = 'user';
        socket.emit('message', { text: `SHELL OPENED (User Level).\nType 'ls', 'cat', 'privesc'.`, type: 'success' });
    } else {
        socket.emit('message', { text: 'Exploit Failed.', type: 'error' });
        delete SESSIONS[user];
    }
}

// --- 4. SHELL INTERCEPT & WALLET CRACKING ---
async function handleShell(user, cmd, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session || session.stage !== 'shell') return false; 

    // --- WALLET CRACK MINIGAME ---
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
                // FAIL
                session.walletChallenge.tries--;
                if (session.walletChallenge.tries <= 0) {
                    socket.emit('message', { text: "ENCRYPTION SEALED. File destroyed.", type: 'error' });
                    delete SESSIONS[user];
                    return true;
                }

                // --- LOGIC: DIGIT REVEAL FOR WALLET ---
                let revealed = false;
                for (let i = 0; i < targetPinStr.length; i++) {
                    // Check bounds and match
                    if (guessStr[i] && guessStr[i] === targetPinStr[i] && session.walletChallenge.known[i] === '*') {
                        session.walletChallenge.known[i] = targetPinStr[i];
                        revealed = true;
                    }
                }

                const dir = guess < session.walletChallenge.pin ? "(Higher)" : "(Lower)";
                let msg = `INVALID KEY. Hint: ${dir}`;
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
            return true;
        }
    }

    // --- STANDARD SHELL ---
    if (cmd === 'ls') {
        socket.emit('message', { text: Object.keys(session.sys.files).join('\n'), type: 'info' });
        return true;
    }

    if (cmd === 'privesc') {
        let p = await Player.findOne({ username: user });
        if (p.hardware.gpu < 1) { socket.emit('message', { text: 'GPU Required.', type: 'error' }); return true; }
        
        socket.emit('message', { text: 'Escalating...', type: 'loading' });
        await delay(2000);
        if (Math.random() > 0.4) {
            session.accessLevel = 'root';
            socket.emit('message', { text: '# ROOT ACCESS GRANTED #', type: 'special' });
        } else socket.emit('message', { text: 'Failed.', type: 'error' });
        return true;
    }

    if (cmd === 'cat' || cmd === 'download') {
        const file = args[0];
        if (!session.sys.files[file]) { socket.emit('message', { text: 'File not found.', type: 'error' }); return true; }

        if (file === 'wallet.dat') {
            if (session.accessLevel !== 'root') { socket.emit('message', { text: 'Access Denied. Need Root.', type: 'error' }); return true; }
            
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
        // ... (Basic file save logic)
        socket.emit('message', { text: 'File saved.', type: 'success' });
        return true;
    }

    if (cmd === 'exit') { delete SESSIONS[user]; socket.emit('message', { text: 'Disconnected.', type: 'info' }); return true; }

    return false;
}

// --- PAYOUT HELPER ---
async function payoutLoot(user, socket, Player, session) {
    let p = await Player.findOne({ username: user });
    let stolen = 0;
    
    if (session.isTargetPlayer && session.target) {
        const t = await Player.findOne({ username: session.target });
        if (t) {
            stolen = Math.floor(t.balance * 0.2);
            t.balance -= stolen;
            t.inbox.push({ from: 'SYSTEM', msg: `ALERT: Wallet cracked by ${user}. -${stolen} ODZ` });
            await t.save();
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

module.exports = { handleNetScan, handleScan, handleExploit, handleShell, handleHackInit, handleGuess };
