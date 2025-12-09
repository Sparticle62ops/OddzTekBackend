// game/hacking.js
const { PORTS, HACK_COOLDOWN, LOOT } = require('./constants');

// Session Store
const SESSIONS = {}; 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateFiles(diff) {
    const files = {};
    if (Math.random() > 0.5) files['user_list.txt'] = "User Data";
    // High tier loot requires Root
    if (diff >= 2) files['wallet.dat'] = "ENCRYPTED_WALLET (Requires ROOT)";
    if (diff >= 3) files['sys_pass.log'] = "ROOT PASSWORD HASH (Requires ROOT)";
    return files;
}

function generatePin(level) {
    const len = level <= 1 ? 3 : (level === 2 ? 4 : 5);
    let pin = '';
    for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
    return pin;
}

function generateSystem(diff) {
    const ip = `192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
    const os = Math.random() > 0.5 ? 'Linux (Ubuntu)' : 'Windows Server 2019';
    
    // Open Ports
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
        files: generateFiles(diff),
        pin: generatePin(diff) // The PIN effectively protects Root Access
    };
}

// --- 1. RECONNAISSANCE ---
async function handleNetScan(user, socket, Player) {
    // Finds random targets
    socket.emit('message', { text: "Scanning subnet...", type: 'loading' });
    await delay(1500);

    const allPlayers = await Player.find({ username: { $ne: user } }).select('username security.firewall');
    const shuffled = allPlayers.sort(() => 0.5 - Math.random()).slice(0, 3);
    const npcNames = ['Corp_Node_01', 'Bank_Relay_X', 'Gov_Uplink'];

    let msg = "\n=== NETWORK TARGETS ===\n";
    shuffled.forEach(p => {
        const ip = `192.168.X.X`;
        const lvl = p.security ? p.security.firewall : 1;
        msg += `${ip.padEnd(15)}| ${p.username.padEnd(15)}| Firewall v${lvl}\n`;
    });
    const npc = npcNames[Math.floor(Math.random() * npcNames.length)];
    msg += `10.0.0.X       | ${npc.padEnd(15)}| Firewall v2 (NPC)\n`;
    
    msg += "\nUsage: scan [hostname]";
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleScan(user, args, socket, Player) {
    const target = args[0];
    if (!target) return socket.emit('message', { text: 'Usage: scan [user]', type: 'error' });

    let t = await Player.findOne({ username: target });
    let diff = 1;

    if (t) diff = t.security ? t.security.firewall : 1;
    else diff = Math.floor(Math.random() * 4) + 1;

    socket.emit('message', { text: `Analysing ${target}...`, type: 'loading' });
    await delay(2000);

    const sys = generateSystem(diff);
    // Initialize Session
    SESSIONS[user] = { 
        target: target, 
        sys: sys, 
        stage: 'recon', 
        accessLevel: 'none',
        cracking: false, // Are we playing PIN game?
        attempts: 5 
    };

    let msg = `\nREPORT: ${sys.ip} (${sys.os})\nPORTS:\n`;
    sys.ports.forEach(p => msg += `[${p.port}] ${p.service} (Vuln: ${p.type})\n`);
    msg += `\nType 'exploit [port]' to breach.`;

    socket.emit('message', { text: msg, type: 'success' });
}

// --- 2. EXPLOIT (Breach Barrier) ---
async function handleExploit(user, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session) return socket.emit('message', { text: 'No target. Scan first.', type: 'error' });
    
    const port = args[0];
    const targetPort = session.sys.ports.find(p => p.port == port);

    if (!targetPort) return socket.emit('message', { text: `Port ${port} closed.`, type: 'error' });

    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastHack < HACK_COOLDOWN) return socket.emit('message', { text: 'Cooldown Active.', type: 'warning' });

    if (targetPort.diff > 2 && p.hardware.ram < 8) {
         return socket.emit('message', { text: `Not enough RAM for Port ${port}.`, type: 'error' });
    }

    socket.emit('message', { text: `Injecting payload...`, type: 'loading' });
    await delay(2000);

    const chance = 0.5 + (p.hardware.gpu * 0.1);
    if (Math.random() < chance) {
        session.stage = 'shell';
        session.accessLevel = 'user';
        socket.emit('message', { text: `ACCESS GRANTED.\nConnected as 'user'.\nType 'ls', 'privesc', or 'crack'.`, type: 'success' });
        socket.emit('play_sound', 'success');
        
        // Cooldown hit only on success
        p.lastHack = Date.now();
        await p.save();
        socket.emit('player_data', p);
    } else {
        socket.emit('message', { text: 'Exploit detected and blocked.', type: 'error' });
        socket.emit('play_sound', 'error');
        delete SESSIONS[user];
    }
}

// --- 3. SHELL INTERACTION ---
async function handleShell(user, cmd, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session || session.stage !== 'shell') return false; 

    // A. PIN CRACKING MINIGAME (The "OG" Mechanic inside the shell)
    if (session.cracking) {
        if (cmd === 'guess') {
            const val = args[0];
            if (!val) { socket.emit('message', { text: 'Usage: guess [pin]', type: 'error' }); return true; }
            
            if (val === session.sys.pin) {
                // WIN PIN GAME
                session.cracking = false;
                session.accessLevel = 'root';
                socket.emit('message', { text: `PIN ACCEPTED.\n# ROOT ACCESS GRANTED #\nFull File Access Unlocked.`, type: 'special' });
                socket.emit('play_sound', 'success');
            } else {
                // FAIL HINT
                session.attempts--;
                if (session.attempts <= 0) {
                    delete SESSIONS[user];
                    socket.emit('message', { text: 'TOO MANY ATTEMPTS. KICKED.', type: 'error' });
                    return true;
                }
                
                const diff = Math.abs(parseInt(val) - parseInt(session.sys.pin));
                let hint = diff <= 10 ? "BURNING HOT" : (diff <= 50 ? "HOT" : "COLD");
                const dir = val < session.sys.pin ? "(Higher)" : "(Lower)";
                
                socket.emit('message', { text: `Incorrect. Signal: ${hint} ${dir}. Tries Left: ${session.attempts}`, type: 'warning' });
            }
            return true;
        } else if (cmd === 'exit' || cmd === 'cancel') {
            session.cracking = false;
            socket.emit('message', { text: 'Cracking aborted.', type: 'info' });
            return true;
        } else {
            socket.emit('message', { text: `[SYSTEM LOCKED] Enter PIN to proceed.\nType 'guess [number]' or 'cancel'.`, type: 'warning' });
            return true; // Block other commands while cracking
        }
    }

    // B. START CRACKING
    if (cmd === 'crack' || cmd === 'privesc') {
        if (session.accessLevel === 'root') {
            socket.emit('message', { text: 'You already have Root access.', type: 'info' });
            return true;
        }
        session.cracking = true;
        socket.emit('message', { 
            text: `INITIATING PRIVILEGE ESCALATION...\nTarget PIN Length: ${session.sys.pin.length}\nType: 'guess [number]'`, 
            type: 'special' 
        });
        return true;
    }

    // C. STANDARD SHELL
    if (cmd === 'ls') {
        let files = Object.keys(session.sys.files);
        let output = "FILES:\n";
        files.forEach(f => {
            const isProtected = f.includes('wallet') || f.includes('core');
            output += `${f.padEnd(20)} ${isProtected ? '[ROOT]' : '[READ]'}\n`;
        });
        socket.emit('message', { text: output, type: 'info' });
        return true;
    }

    if (cmd === 'cat' || cmd === 'download') {
        const file = args[0];
        if (!session.sys.files[file]) { socket.emit('message', { text: 'File not found.', type: 'error' }); return true; }

        if ((file.includes('wallet') || file.includes('core')) && session.accessLevel !== 'root') {
             socket.emit('message', { text: `PERMISSION DENIED.\nRoot Access Required.\nType 'crack' to bypass.`, type: 'error' });
             return true;
        }

        socket.emit('message', { text: `Extracting ${file}...`, type: 'loading' });
        await delay(1500);

        let p = await Player.findOne({ username: user });
        
        // REWARDS
        if (file === 'wallet.dat') {
             // If PvP, steal from real player
             let stolen = 0;
             let t = await Player.findOne({ username: session.target });
             
             if (t) { // Steal from player
                 stolen = Math.floor(t.balance * 0.25);
                 t.balance -= stolen;
                 t.inbox.push({ from: 'SYSTEM', msg: `ALERT: ${user} hacked your wallet. -${stolen} ODZ.` });
                 await t.save();
             } else { // NPC loot
                 stolen = Math.floor(Math.random() * 800) + 400;
             }
             
             p.balance += stolen;
             socket.emit('message', { text: `FUNDS SECURED: +${stolen} ODZ`, type: 'success' });
             socket.emit('play_sound', 'coin');
        } else {
             socket.emit('message', { text: "Data Analyzed. Junk data.", type: 'info' });
        }
        
        await p.save();
        socket.emit('player_data', p);
        
        // Close session after big loot
        if (file.includes('wallet')) {
            delete SESSIONS[user];
            socket.emit('message', { text: 'Connection terminated to cover tracks.', type: 'info' });
        }
        return true;
    }

    if (cmd === 'exit') {
        delete SESSIONS[user];
        socket.emit('message', { text: 'Logged out.', type: 'info' });
        return true;
    }

    return false; 
}

module.exports = { handleNetScan, handleScan, handleExploit, handleShell };
