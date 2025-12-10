// game/hacking.js
const { PORTS, HACK_COOLDOWN } = require('./constants');

const SESSIONS = {}; 
const ACTIVE_HACKS = {}; 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- LOOT SYSTEM ---
function generateLoot(diff, isPlayer) {
    const files = {};
    const rng = Math.random();

    // Standard Data
    files['user_data.txt'] = "User Data (Sellable)";
    
    // Quest/Money
    if (isPlayer || (diff >= 3 && Math.random() > 0.6)) files['wallet.dat'] = "ENCRYPTED_WALLET";
    
    // LEGENDARY DROPS (High Security Targets Only)
    // 5% Chance on targets with diff >= 4
    if (diff >= 4 && rng > 0.95) {
        files['NSA_Backdoor.exe'] = "LEGENDARY ARTIFACT (Value: 50,000 ODZ)";
    }
    // Rare Hardware Blueprints
    if (diff >= 3 && rng > 0.85 && rng < 0.90) {
        files['prototype_blueprint.dat'] = "RARE BLUEPRINT (Sellable)";
    }

    if (diff >= 4) files['sys_core.log'] = "ROOT ACCESS LOG";
    return files;
}

function generateSystem(diff, isPlayer) {
    const ip = `192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
    const os = Math.random() > 0.5 ? 'Linux (Ubuntu)' : 'Windows Server 2019';
    const openPorts = [];
    const keys = Object.keys(PORTS);
    
    let count = Math.max(1, 5 - diff); 
    if (diff === 1) count = 4;
    
    for(let i=0; i<count; i++) {
        const p = keys[Math.floor(Math.random() * keys.length)];
        if (!openPorts.find(x => x.port == p)) {
            openPorts.push({ port: parseInt(p), ...PORTS[p] });
        }
    }
    if (openPorts.length === 0) openPorts.push({ port: 80, ...PORTS[80] });

    return { 
        ip, os, 
        ports: openPorts, 
        files: generateLoot(diff, isPlayer) 
    };
}

function generatePin(level) {
    const len = level <= 1 ? 3 : (level === 2 ? 4 : 5);
    let pin = '';
    for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
    return pin;
}

// --- 1. RECON ---
async function handleNetScan(user, socket, Player) {
    socket.emit('message', { text: "Scanning subnet...", type: 'loading' });
    await delay(1500);

    const players = await Player.find({ username: { $ne: user } }).select('username security.firewall bounty').limit(3);
    const npcNames = ['Global_Bank', 'Omega_Server', 'Dark_Relay'];
    
    let msg = "\n=== NETWORK TARGETS ===\n";
    players.forEach(pl => {
        const bountyTxt = pl.bounty > 0 ? ` [BOUNTY: ${pl.bounty}]` : "";
        msg += `IP: 192.168.X.X  | USER: ${pl.username.padEnd(12)} | FW: v${pl.security.firewall}${bountyTxt}\n`;
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

    socket.emit('message', { text: `Analyzing ${target}...`, type: 'loading' });
    await delay(2000);

    const sys = generateSystem(diff, isPlayer);
    SESSIONS[user] = { target: target, sys: sys, stage: 'recon', accessLevel: 'none', isTargetPlayer: isPlayer };

    let msg = `\nREPORT: ${sys.ip} (${sys.os})\nPORTS:\n`;
    sys.ports.forEach(p => msg += `[${p.port}] ${p.service} (Vuln: ${p.type})\n`);
    msg += `\n>> Use 'exploit [port] [virus_name]' to attack.`;

    socket.emit('message', { text: msg, type: 'success' });
}

// --- 2. EXPLOIT (With Virus Integration) ---
async function handleExploit(user, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session) return socket.emit('message', { text: 'No active target. Scan first.', type: 'error' });
    
    const port = args[0];
    const virusName = args[1]; // NEW: Custom Virus
    const targetPort = session.sys.ports.find(p => p.port == port);

    if (!targetPort) return socket.emit('message', { text: `Port ${port} is closed.`, type: 'error' });

    let p = await Player.findOne({ username: user });
    
    // RAM Check
    if (targetPort.diff > 2 && p.hardware.ram < 8) {
         return socket.emit('message', { text: `Insufficient RAM. Need upgrade.`, type: 'error' });
    }

    // CALCULATE ODDS
    let baseChance = 0.5;
    let attackPower = 0;
    let stealth = 0;

    // Use Virus Stats if provided
    if (virusName) {
        const virus = p.software.find(s => s.name.toLowerCase() === virusName.toLowerCase());
        if (virus) {
            attackPower = virus.power * 0.1; // 10% per level
            stealth = virus.stealth * 0.1;
            socket.emit('message', { text: `Injecting ${virus.name} (Lv${virus.level})...`, type: 'loading' });
        } else {
            return socket.emit('message', { text: `Virus '${virusName}' not found.`, type: 'error' });
        }
    } else {
        socket.emit('message', { text: `Running generic script...`, type: 'loading' });
    }

    // Hardware Bonus
    const gpuBonus = (p.hardware.gpu || 0) * 0.05; 
    
    const totalChance = baseChance + attackPower + gpuBonus;
    
    await delay(2000);

    if (Math.random() < totalChance) {
        session.stage = 'shell';
        session.accessLevel = 'user';
        socket.emit('message', { text: `ACCESS GRANTED.\nConnected as 'user'.\nType 'ls', 'cat', 'privesc', or 'crack'.`, type: 'success' });
    } else {
        // Did we get caught? (Stealth check)
        if (Math.random() > (0.3 + stealth)) {
             socket.emit('message', { text: 'IDS ALERT: Attack traced. Connection reset.', type: 'error' });
             delete SESSIONS[user];
        } else {
             socket.emit('message', { text: 'Exploit Failed (Stealth maintained). Try again.', type: 'warning' });
        }
    }
}

// --- 3. SHELL & LOOT ---
async function handleShell(user, cmd, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session || session.stage !== 'shell') return false; 

    // --- PIN MINIGAME ---
    if (session.walletChallenge) {
        if (cmd === 'unlock' || cmd === 'guess') {
            const guess = parseInt(args[0]);
            if (isNaN(guess)) { socket.emit('message', { text: "Usage: unlock [number]", type: 'error' }); return true; }

            if (guess === session.walletChallenge.pin) {
                socket.emit('message', { text: "KEY ACCEPTED.", type: 'success' });
                await delay(1000);
                await payoutLoot(user, socket, Player, session);
                session.walletChallenge = null;
            } else {
                session.walletChallenge.tries--;
                if (session.walletChallenge.tries <= 0) {
                    socket.emit('message', { text: "ENCRYPTION SEALED.", type: 'error' });
                    delete SESSIONS[user];
                    return true;
                }
                const dir = guess < session.walletChallenge.pin ? "(Higher)" : "(Lower)";
                
                // Match logic
                const pinS = session.walletChallenge.pin.toString();
                const guessS = guess.toString().padStart(3,'0');
                for(let i=0; i<3; i++) {
                    if(guessS[i] === pinS[i]) session.walletChallenge.known[i] = pinS[i];
                }

                socket.emit('message', { 
                    text: `INVALID. Hint: ${dir}.\nKNOWN: [ ${session.walletChallenge.known.join(' ')} ]`, 
                    type: 'warning' 
                });
            }
            return true;
        } 
        return true; 
    }

    if (cmd === 'ls') {
        const files = Object.keys(session.sys.files);
        socket.emit('message', { text: files.join('\n'), type: 'info' });
        return true;
    }

    if (cmd === 'cat' || cmd === 'download') {
        const file = args[0];
        if (!session.sys.files[file]) { socket.emit('message', { text: 'File not found.', type: 'error' }); return true; }

        // SPECIAL LOOT LOGIC
        if (file === 'NSA_Backdoor.exe') {
             socket.emit('message', { text: `Retrieving LEGENDARY Artifact...`, type: 'loading' });
             await delay(2000);
             let p = await Player.findOne({ username: user });
             p.balance += 50000;
             p.xp += 1000;
             await p.save();
             socket.emit('message', { text: `ARTIFACT SECURED. Sold to Black Market: +50,000 ODZ`, type: 'special' });
             delete SESSIONS[user];
             return true;
        }

        if (file === 'wallet.dat') {
            const pin = Math.floor(Math.random() * 900) + 100;
            session.walletChallenge = { pin: pin, tries: 5, known: ['*','*','*'] };
            socket.emit('message', { text: `[ENCRYPTION] Crack 3-digit PIN.\nType 'unlock [number]'.`, type: 'special' });
            return true;
        }

        // Generic File
        socket.emit('message', { text: `Downloaded ${file}.`, type: 'success' });
        return true;
    }
    
    // ... (Keep existing privesc / exit logic from previous turn)
    if (cmd === 'exit') { delete SESSIONS[user]; socket.emit('message', { text: 'Closed.', type: 'info' }); return true; }
    if (cmd === 'privesc') { 
        // ... same as before
        socket.emit('message', { text: 'Escalating...', type: 'loading' });
        await delay(1500);
        session.accessLevel = 'root'; // Simplified for brevity here
        socket.emit('message', { text: 'ROOT ACCESS GRANTED.', type: 'special' });
        return true; 
    }

    return false;
}

// --- PAYOUT (Includes Bounty) ---
async function payoutLoot(user, socket, Player, session) {
    let p = await Player.findOne({ username: user });
    let total = 0;
    
    if (session.isTargetPlayer && session.target) {
        const t = await Player.findOne({ username: session.target });
        if (t) {
            // 1. Steal Wallet (25%)
            const steal = Math.floor(t.balance * 0.25);
            t.balance -= steal;
            total += steal;
            
            // 2. Claim Bounty
            if (t.bounty > 0) {
                total += t.bounty;
                socket.emit('message', { text: `BOUNTY CLAIMED: Target eliminated. +${t.bounty} ODZ`, type: 'special' });
                // Reset bounty? Or reduce? Let's reset.
                t.bounty = 0; 
            }
            
            t.inbox.push({ from: 'SYSTEM', msg: `ALERT: Hacked by ${user}. Lost ${steal} ODZ.` });
            await t.save();
        }
    } else {
        total = Math.floor(Math.random() * 800) + 400;
    }
    
    p.balance += total;
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `TRAFFIC CLEARED. Total Gain: +${total} ODZ`, type: 'success' });
    delete SESSIONS[user];
}

module.exports = { handleNetScan, handleScan, handleExploit, handleShell, handleHackInit: null, handleGuess: null };
