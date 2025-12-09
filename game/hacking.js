// game/hacking.js
const { PORTS, HACK_COOLDOWN, LOOT } = require('./constants');

// Session Store: { user: { target, sys, stage, accessLevel } }
const SESSIONS = {}; 

function generateFiles(diff) {
    const files = {};
    // Chance for loot based on difficulty
    if (Math.random() > 0.5) files['user_data.txt'] = "Regular User Data";
    if (diff >= 3 && Math.random() > 0.7) files['wallet.dat'] = "ENCRYPTED_WALLET";
    if (diff >= 4) files['sys_core.log'] = "ROOT ACCESS LOG";
    return files;
}

// --- HELPER: GENERATE TARGET SYSTEM ---
function generateSystem(diff) {
    const ip = `192.168.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
    const os = Math.random() > 0.5 ? 'Linux (Ubuntu)' : 'Windows Server 2019';
    
    const openPorts = [];
    const portKeys = Object.keys(PORTS);
    
    // Logic: Higher difficulty -> fewer obvious vulnerabilities
    // diff 1 (easy) -> 4 ports
    // diff 5 (hard) -> 1 port
    let count = Math.max(1, 5 - diff); 
    if (diff === 1) count = 4; 
    
    for(let i=0; i<count; i++) {
        const p = portKeys[Math.floor(Math.random() * portKeys.length)];
        if (!openPorts.find(x => x.port == p)) {
            openPorts.push({ port: parseInt(p), ...PORTS[p] });
        }
    }
    
    // CRITICAL FIX: Fallback if random selection failed or array empty
    if (openPorts.length === 0) {
        openPorts.push({ port: 80, ...PORTS[80] });
    }

    return { ip, os, ports: openPorts, files: generateFiles(diff) };
}

// --- 1. SCAN ---
async function handleScan(user, args, socket, Player) {
    const target = args[0];
    if (!target) return socket.emit('message', { text: 'Usage: scan [ip/user]', type: 'error' });

    let t = await Player.findOne({ username: target });
    let diff = 1;
    let name = target;

    // PvP vs PvE check
    if (t) {
        // Player target: difficulty based on their firewall upgrade
        diff = t.security ? t.security.firewall : 1; 
    } else {
        // NPC target
        name = "Unknown Host";
        diff = Math.floor(Math.random() * 5) + 1;
    }

    socket.emit('message', { text: `Scanning ${target}...`, type: 'loading' });
    await new Promise(r => setTimeout(r, 2000));

    const sys = generateSystem(diff);
    SESSIONS[user] = { target: target, sys: sys, stage: 'recon', accessLevel: 'none' };

    let msg = `\nSCAN COMPLETE: ${sys.ip} (${sys.os})\nPORTS:\n`;
    if (sys.ports.length === 0) {
        msg += "No open ports found. (This shouldn't happen)\n";
    } else {
        sys.ports.forEach(p => msg += `[${p.port}] ${p.service} (Vuln: ${p.type})\n`);
    }
    msg += `\nType 'exploit [port]' to attack.`;

    socket.emit('message', { text: msg, type: 'success' });
}

// --- 2. EXPLOIT ---
async function handleExploit(user, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session) return socket.emit('message', { text: 'No active target. Scan first.', type: 'error' });
    
    const port = args[0];
    const targetPort = session.sys.ports.find(p => p.port == port);

    if (!targetPort) return socket.emit('message', { text: `Port ${port} is closed or invalid.`, type: 'error' });

    // Check Hardware Requirements
    let p = await Player.findOne({ username: user });
    
    // RAM Check for complex exploits (diff > 2 needs 8GB+)
    // Assuming p.hardware.ram is set. Default is 8.
    if (targetPort.diff > 2 && p.hardware.ram < 8) {
         return socket.emit('message', { text: `Insufficient RAM. Need upgrade to exploit Port ${port}.`, type: 'error' });
    }

    socket.emit('message', { text: `Running ${targetPort.type}...`, type: 'loading' });
    await new Promise(r => setTimeout(r, 2500));

    // Success Chance
    const baseChance = 0.5;
    const gpuBonus = (p.hardware.gpu || 0) * 0.1; 
    const chance = baseChance + gpuBonus;

    if (Math.random() < chance) {
        session.stage = 'shell';
        session.accessLevel = 'user';
        socket.emit('message', { text: `ACCESS GRANTED.\nShell Connection Established (User Level).\nType 'ls', 'cat', or 'privesc'.`, type: 'success' });
        socket.emit('play_sound', 'success');
    } else {
        socket.emit('message', { text: 'Exploit Failed. Connection Reset.', type: 'error' });
        socket.emit('play_sound', 'error');
        delete SESSIONS[user];
    }
}

// --- 3. SHELL COMMANDS ---
async function handleShell(user, cmd, args, socket, Player) {
    const session = SESSIONS[user];
    if (!session || session.stage !== 'shell') return false; // Not handled here

    if (cmd === 'ls') {
        const files = Object.keys(session.sys.files);
        socket.emit('message', { text: files.length ? files.join('\n') : 'Directory Empty', type: 'info' });
        return true;
    }

    if (cmd === 'privesc') {
        // Privilege Escalation
        let p = await Player.findOne({ username: user });
        if (p.hardware.gpu < 1) {
             socket.emit('message', { text: 'GPU Required for Root Force attack.', type: 'error' });
             return true;
        }
        
        socket.emit('message', { text: 'Attemping Root escalation...', type: 'loading' });
        await new Promise(r => setTimeout(r, 2000));

        if (Math.random() > 0.4) {
            session.accessLevel = 'root';
            socket.emit('message', { text: '# ROOT ACCESS GRANTED #', type: 'special' });
        } else {
            socket.emit('message', { text: 'Escalation Failed.', type: 'error' });
        }
        return true;
    }

    if (cmd === 'cat' || cmd === 'download') {
        const file = args[0];
        if (!session.sys.files[file]) {
             socket.emit('message', { text: 'File not found.', type: 'error' });
             return true;
        }

        // Check Permissions
        if (file === 'sys_core.log' && session.accessLevel !== 'root') {
             socket.emit('message', { text: 'Permission Denied: Root Required.', type: 'error' });
             return true;
        }

        socket.emit('message', { text: `Downloading ${file}...`, type: 'loading' });
        await new Promise(r => setTimeout(r, 1500));

        // Loot Logic
        let p = await Player.findOne({ username: user });
        if (file === 'wallet.dat') {
             const amt = Math.floor(Math.random() * 500) + 500;
             p.balance += amt;
             socket.emit('message', { text: `Decrypted Wallet: +${amt} ODZ`, type: 'success' });
        } else {
             // Basic File
             if (!p.files.includes(file)) p.files.push(file); // Add to local inventory
             socket.emit('message', { text: `File saved to local storage.`, type: 'success' });
        }
        
        await p.save();
        socket.emit('player_data', p);
        return true;
    }

    // Exit shell
    if (cmd === 'exit') {
        delete SESSIONS[user];
        socket.emit('message', { text: 'Connection Closed.', type: 'info' });
        return true;
    }

    return false; // Command not found in shell
}

module.exports = { handleScan, handleExploit, handleShell };
