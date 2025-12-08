// game/hacking.js
const { HACK_COOLDOWN } = require('./constants');

const ACTIVE_HACKS = {}; // In-memory session store

function generatePin(level) {
    const len = level === 1 ? 3 : (level === 2 ? 4 : 5);
    let pin = '';
    for(let i=0; i<len; i++) pin += Math.floor(Math.random() * 10);
    return pin;
}

// --- SCAN ---
async function handleScan(user, args, socket, Player) {
    const target = args[0];
    if (!target) return socket.emit('message', { text: 'Usage: scan [user]', type: 'error' });
    
    const t = await Player.findOne({ username: target });
    if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
    
    const wealth = t.balance > 1000 ? 'HIGH' : (t.balance > 200 ? 'MEDIUM' : 'LOW');
    socket.emit('message', { 
        text: `SCAN RESULT [${target}]:\nLevel: ${t.level}\nFirewall: v${t.securityLevel}.0\nWealth Estimate: ${wealth}`, 
        type: 'system' 
    });
}

// --- INIT HACK ---
async function handleHackInit(user, args, socket, Player) {
    const targetName = args[0];
    if (!targetName || targetName === user) return socket.emit('message', { text: 'Invalid Target.', type: 'error' });

    const target = await Player.findOne({ username: targetName });
    if (!target) return socket.emit('message', { text: 'Target offline.', type: 'error' });

    let p = await Player.findOne({ username: user });
    if (Date.now() - p.lastHack < HACK_COOLDOWN) {
        const wait = Math.ceil((HACK_COOLDOWN - (Date.now() - p.lastHack))/1000);
        return socket.emit('message', { text: `Hack Cooldown: ${wait}s remaining.`, type: 'warning' });
    }

    // Honeypot Logic
    if (target.activeHoneypot) {
        const fine = Math.floor(p.balance * 0.5);
        p.balance -= fine;
        target.activeHoneypot = false;
        target.balance += fine;
        await p.save(); await target.save();
        
        socket.emit('player_data', p);
        socket.emit('message', { text: `⚠️ HONEYPOT TRIGGERED! You lost ${fine} ODZ!`, type: 'error' });
        socket.emit('play_sound', 'error');
        return;
    }

    const pin = generatePin(target.securityLevel);
    let known = Array(pin.length).fill('*');
    let extraMsg = "";

    // Decryptor Tool
    if (p.inventory.includes('decryptor_v1')) {
        const idx = Math.floor(Math.random() * pin.length);
        known[idx] = pin[idx];
        extraMsg = `\n[TOOL] Decryptor revealed digit at pos ${idx+1}`;
    }

    ACTIVE_HACKS[user] = {
        target: targetName,
        pin: pin,
        attempts: 6,
        expires: Date.now() + 45000,
        known: known
    };

    socket.emit('message', { 
        text: `BREACH STARTED on ${targetName}.\nPIN: [ ${known.join(' ')} ]${extraMsg}\nTime: 45s. Type: guess [pin]`, 
        type: 'special' 
    });
    socket.emit('play_sound', 'login');
}

// --- GUESS ---
async function handleGuess(user, args, socket, Player) {
    const session = ACTIVE_HACKS[user];
    if (!session) return socket.emit('message', { text: 'No active hack.', type: 'error' });

    if (Date.now() > session.expires) {
        delete ACTIVE_HACKS[user];
        return socket.emit('message', { text: 'Connection Timed Out.', type: 'error' });
    }

    const val = args[0];
    if (!val || val.length !== session.pin.length) {
        return socket.emit('message', { text: `Invalid Input. Required length: ${session.pin.length}`, type: 'error' });
    }

    if (val === session.pin) {
        // SUCCESS
        delete ACTIVE_HACKS[user];
        
        const t = await Player.findOne({ username: session.target });
        const p = await Player.findOne({ username: user });
        
        const stolen = Math.floor(t.balance * 0.25); // 25% Theft
        t.balance -= stolen;
        p.balance += stolen;
        p.lastHack = Date.now();
        p.xp += 50;

        // Rare Drop
        if (Math.random() > 0.8) {
            const secretFile = 'server_log_01.txt';
            if (!p.files.includes(secretFile)) {
                p.files.push(secretFile);
                socket.emit('message', { text: `DATA DUMP: Recovered '${secretFile}'`, type: 'special' });
            }
        }

        await t.save(); await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: `ACCESS GRANTED. Transferred ${stolen} ODZ.`, type: 'success' });
        socket.emit('play_sound', 'success');

    } else {
        // FAIL
        session.attempts--;
        if (session.attempts <= 0) {
            delete ACTIVE_HACKS[user];
            socket.emit('message', { text: 'SECURITY LOCKOUT. Access Denied.', type: 'error' });
            return;
        }

        // Logic: Reveal known digits if matched in correct pos
        let matched = false;
        for(let i=0; i<session.pin.length; i++) {
            if(val[i] === session.pin[i] && session.known[i] === '*') {
                session.known[i] = val[i];
                matched = true;
            }
        }

        // Logic: Hot/Cold Hint
        const diff = Math.abs(parseInt(val) - parseInt(session.pin));
        let hint = diff <= 20 ? "BURNING HOT" : (diff <= 50 ? "HOT" : (diff <= 100 ? "WARM" : "COLD"));
        const dir = val < session.pin ? "(Higher)" : "(Lower)";

        let msg = `Incorrect. Signal: ${hint} ${dir}.`;
        if (matched) msg += `\n[!] DIGIT MATCHED! PIN: [ ${session.known.join(' ')} ]`;
        else msg += `\nPIN State: [ ${session.known.join(' ')} ]`;
        
        msg += `\nTries: ${session.attempts}`;

        socket.emit('message', { text: msg, type: 'warning' });
    }
}

// --- BRUTE FORCE ---
async function handleBrute(user, args, socket, Player) {
    if (!ACTIVE_HACKS[user] || ACTIVE_HACKS[user].target !== args[0]) {
        return socket.emit('message', { text: 'No active breach on this target.', type: 'error' });
    }
    
    let p = await Player.findOne({ username: user });
    if (!p.inventory.includes('brute_force_v1')) {
        return socket.emit('message', { text: 'Tool not installed.', type: 'error' });
    }

    // Consume item
    const idx = p.inventory.indexOf('brute_force_v1');
    p.inventory.splice(idx, 1);
    await p.save();

    const s = ACTIVE_HACKS[user];
    const unknowns = s.known.map((v, i) => v === '*' ? i : -1).filter(i => i !== -1);
    
    if (unknowns.length > 0) {
        const k = unknowns[Math.floor(Math.random() * unknowns.length)];
        s.known[k] = s.pin[k];
        socket.emit('message', { text: `[BRUTE FORCE] Cracked Digit ${k+1}: ${s.pin[k]}`, type: 'special' });
        socket.emit('message', { text: `PIN: [ ${s.known.join(' ')} ]`, type: 'info' });
        socket.emit('player_data', p);
    } else {
        socket.emit('message', { text: 'PIN already known.', type: 'info' });
    }
}

module.exports = { handleScan, handleHackInit, handleGuess, handleBrute };