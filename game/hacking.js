// game/hacking.js
const { PORTS, HACK_COOLDOWN } = require('./constants');
const { getNPCs, findNPC } = require('./npcs');

// --- STATE MANAGEMENT ---
// Key: username, Value: { target, ip, trace: 0, access: 0, integrity: 100, log: [], timer: null }
const SESSIONS = {}; 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- HELPERS ---
function generateLoot(diff, isPlayer) {
    const files = {};
    const rng = Math.random();

    files['user_data.txt'] = "User Data (Sellable)";
    
    if (isPlayer || (diff >= 3 && Math.random() > 0.6)) files['wallet.dat'] = "ENCRYPTED_WALLET";
    
    if (diff >= 4 && rng > 0.95) files['NSA_Backdoor.exe'] = "LEGENDARY ARTIFACT (Value: 50,000 ODZ)";
    if (diff >= 3 && rng > 0.85 && rng < 0.90) files['prototype_blueprint.dat'] = "RARE BLUEPRINT (Sellable)";
    if (diff >= 4) files['sys_core.log'] = "ROOT ACCESS LOG";
    return files;
}

function getSession(user) {
    return SESSIONS[user];
}

function clearSession(user) {
    if (SESSIONS[user]?.timer) clearInterval(SESSIONS[user].timer);
    delete SESSIONS[user];
}

// --- COMMANDS ---

async function handleNetScan(user, socket, Player) {
    socket.emit('message', { text: "Scanning subnet...", type: 'loading' });
    await delay(1500);

    const players = await Player.find({ username: { $ne: user } }).select('username security.firewall bounty').limit(3);
    const npcs = getNPCs(); // Get active NPCs
    
    let msg = "\n=== NETWORK TARGETS ===\n";
    
    // List Players
    players.forEach(pl => {
        const bountyTxt = pl.bounty > 0 ? ` [BOUNTY: ${pl.bounty}]` : "";
        msg += `IP: 192.168.X.X  | USER: ${pl.username.padEnd(12)} | FW: v${pl.security.firewall}${bountyTxt}\n`;
    });

    // List NPCs
    msg += "\n--- DETECTED ENTITIES ---\n";
    npcs.forEach(npc => {
        msg += `IP: 10.0.0.X     | ENTITY: ${npc.username.padEnd(15)} | FW: v${npc.security.firewall} [${npc.faction}]\n`;
    });
    
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleScan(user, args, socket, Player) {
    const targetName = args[0];
    if (!targetName) return socket.emit('message', { text: 'Usage: scan [ip/user]', type: 'error' });

    // Check if NPC
    const npc = findNPC(targetName);
    let target = null;
    let isNPC = false;

    if (npc) {
        target = npc;
        isNPC = true;
    } else {
        target = await Player.findOne({ username: targetName });
    }

    if (!target) return socket.emit('message', { text: 'Target not found or offline.', type: 'error' });

    socket.emit('message', { text: `Resolving host ${targetName}...`, type: 'loading' });
    await delay(1500);

    const fw = target.security.firewall;
    const hp = target.security.honeypot ? "DETECTED" : "NONE";
    
    let msg = `\n=== SCAN REPORT: ${targetName} ===\n`;
    msg += `FIREWALL INTEGRITY : ${fw * 200} HP\n`;
    msg += `ENCRYPTION LEVEL   : ${isNPC ? target.security.traceSpeed : 'STANDARD'}\n`;
    msg += `ACTIVE DEFENSES    : ${hp}\n`;
    msg += `\nTo begin intrusion: 'exploit ${targetName}'\n`;

    socket.emit('message', { text: msg, type: 'success' });
}

async function handleExploit(user, args, socket, Player) {
    const targetName = args[0];
    if (SESSIONS[user]) return socket.emit('message', { text: "Session already active. 'dc' to exit.", type: 'error' });
    if (!targetName) return socket.emit('message', { text: 'Usage: exploit [user]', type: 'error' });

    // Identify Target
    let target = findNPC(targetName);
    let isNPC = !!target;
    if (!target) target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'Target invalid.', type: 'error' });

    if (target.username === user) return socket.emit('message', { text: 'Cannot hack localhost.', type: 'error' });

    // Init Session
    const fwLevel = target.security.firewall;
    const session = {
        targetName: target.username,
        isNPC,
        integrity: fwLevel * 200, // Firewall HP
        maxIntegrity: fwLevel * 200,
        access: 0, // Need 100 to win
        trace: 0, // Lose at 100
        traceRate: isNPC ? target.security.traceSpeed : 1, // Trace increase per tick
        status: 'CONNECTED',
        loot: generateLoot(fwLevel, !isNPC)
    };

    SESSIONS[user] = session;

    socket.emit('message', { text: `CONNECTED TO ${targetName}. TRACE STARTED.`, type: 'warning' });
    socket.emit('message', { text: `Usage: 'probe', 'brute', 'inject', 'dc'`, type: 'info' });

    // Start Trace Timer
    session.timer = setInterval(() => {
        if (!SESSIONS[user]) return;
        SESSIONS[user].trace += SESSIONS[user].traceRate;
        
        // Random Counter-Measure
        if (Math.random() > 0.85) {
            SESSIONS[user].trace += 5;
            socket.emit('message', { text: `[!] HOSTILE TRACE DETECTED (+5%)`, type: 'error' });
        }

        if (SESSIONS[user].trace >= 100) {
            failHack(user, socket);
        }
    }, 2000);
}

function failHack(user, socket) {
    clearSession(user);
    socket.emit('message', { text: `\n!!! CONNECTION TERMINATED !!!\nTRACE COMPLETED. IP LOGGED.\n`, type: 'error' });
    socket.emit('play_sound', 'error');
}

async function handleProbe(user, args, socket, Player) {
    const s = getSession(user);
    if (!s) return socket.emit('message', { text: "No active session.", type: 'error' });

    let msg = `\n=== SESSION STATUS: ${s.targetName} ===\n`;
    msg += `TRACE LEVEL : [${'#'.repeat(Math.floor(s.trace/10)).padEnd(10, '-')}] ${s.trace}%\n`;
    msg += `ACCESS LEVEL: [${'#'.repeat(Math.floor(s.access/10)).padEnd(10, '-')}] ${s.access}%\n`;
    msg += `FIREWALL    : ${s.integrity}/${s.maxIntegrity}\n`;
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleBrute(user, args, socket, Player) {
    const s = getSession(user);
    if (!s) return socket.emit('message', { text: "No active session.", type: 'error' });

    const dmg = Math.floor(Math.random() * 40) + 20;
    s.integrity -= dmg;
    s.trace += 2; // Noise

    if (s.integrity <= 0) {
        s.integrity = 0;
        socket.emit('message', { text: `FIREWALL BREACHED! System Vulnerable.`, type: 'success' });
    } else {
        socket.emit('message', { text: `Brute Force: -${dmg} Integrity. Trace +2%`, type: 'info' });
    }
}

async function handleInject(user, args, socket, Player) {
    const s = getSession(user);
    if (!s) return socket.emit('message', { text: "No active session.", type: 'error' });

    if (s.integrity > 0) {
        return socket.emit('message', { text: "Firewall Active. Cannot inject payload.", type: 'error' });
    }

    const gain = Math.floor(Math.random() * 20) + 10;
    s.access += gain;
    s.trace += 5;

    if (s.access >= 100) {
        // WIN CONDITION
        await successHack(user, socket, Player);
    } else {
        socket.emit('message', { text: `Injection: +${gain}% Access. Trace +5%`, type: 'success' });
    }
}

async function successHack(user, socket, Player) {
    const s = getSession(user);
    const targetName = s.targetName;
    const loot = s.loot;
    
    clearSession(user);
    
    // Grant Loot
    let p = await Player.findOne({ username: user });
    
    let msg = `\n=== ROOT ACCESS GRANTED ===\nTarget: ${targetName}\n\nFILES DOWNLOADED:\n`;
    
    for (const [file, desc] of Object.entries(loot)) {
        msg += `- ${file}: ${desc}\n`;
        // Handle Loot Logic (Wallet, etc)
        if (file === 'wallet.dat') {
            const val = Math.floor(Math.random() * 500) + 200;
            p.balance += val;
            msg += `  > Decrypted: ${val} ODZ\n`;
        } else {
            p.files.push(file); // Store file
        }
    }
    
    p.xp += 100;
    if (p.xp >= 1000) {
        p.level++;
        p.xp = 0;
        msg += `\nLEVEL UP! You are now Level ${p.level}.\n`;
    }
    
    await p.save();
    
    socket.emit('message', { text: msg, type: 'success' });
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
}

async function handleDisconnect(user, socket, Player) {
    if (SESSIONS[user]) {
        clearSession(user);
        socket.emit('message', { text: "Disconnected from session.", type: 'info' });
    } else {
        socket.emit('message', { text: "No active session.", type: 'error' });
    }
}

// --- SHELL ---
// This was the old way to interact with hacked systems.
// We can repurpose it or deprecate it. For now, we'll return false to let global commands run.
async function handleShell(user, command, args, socket, Player) {
    return false; 
}

module.exports = { 
    handleNetScan, handleScan, handleExploit, 
    handleProbe, handleBrute, handleInject, handleDisconnect,
    handleShell 
};
