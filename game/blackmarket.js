// game/blackmarket.js

// --- 1. BOUNTY SYSTEM ---
async function handleBounty(user, args, socket, Player) {
    const action = args[0] ? args[0].toLowerCase() : 'list';
    
    if (action === 'place') {
        const targetName = args[1];
        const amount = parseInt(args[2]);
        
        if (!targetName || isNaN(amount) || amount <= 0) {
            return socket.emit('message', { text: 'Usage: bounty place [user] [amount]', type: 'error' });
        }
        
        let p = await Player.findOne({ username: user });
        if (p.balance < amount) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
        
        let t = await Player.findOne({ username: targetName });
        if (!t) return socket.emit('message', { text: 'Target not found.', type: 'error' });
        
        // Transaction
        p.balance -= amount;
        t.bounty += amount;
        
        // Notifications
        t.inbox.push({ from: 'The Broker', msg: `WARNING: A bounty of ${amount} ODZ has been placed on your head.` });
        
        await p.save();
        await t.save();
        
        socket.emit('player_data', p);
        socket.emit('message', { text: `Bounty of ${amount} ODZ placed on ${targetName}.`, type: 'special' });
    }
    else if (action === 'list') {
        // Find top 5 bounties
        const targets = await Player.find({ bounty: { $gt: 0 } }).sort({ bounty: -1 }).limit(5);
        if (targets.length === 0) {
            return socket.emit('message', { text: 'No active bounties.', type: 'info' });
        }
        
        let msg = "\n=== MOST WANTED ===\n";
        targets.forEach(t => {
            msg += `TARGET: ${t.username.padEnd(12)} | BOUNTY: ${t.bounty} ODZ | RISK: v${t.security.firewall}\n`;
        });
        socket.emit('message', { text: msg, type: 'special' });
    }
}

// --- 2. VIRUS CONSTRUCTION KIT ---
async function handleVirus(user, args, socket, Player) {
    const action = args[0] ? args[0].toLowerCase() : 'list';
    let p = await Player.findOne({ username: user });
    
    // LIST YOUR VIRUSES
    if (action === 'list') {
        if (!p.software || p.software.length === 0) {
            return socket.emit('message', { text: "No custom software compiled. Type 'virus help'.", type: 'info' });
        }
        let msg = "\n=== CUSTOM MALWARE LIB ===\n";
        p.software.forEach((s, i) => {
            msg += `[${i+1}] ${s.name} (Lvl ${s.level}) | PWR: ${s.power} | STL: ${s.stealth}\n`;
        });
        socket.emit('message', { text: msg, type: 'success' });
    }
    
    // CREATE NEW VIRUS
    else if (action === 'create') {
        const name = args[1];
        if (!name) return socket.emit('message', { text: 'Usage: virus create [name]', type: 'error' });
        
        if (p.software.length >= 3) return socket.emit('message', { text: 'Memory Full. Delete old viruses first.', type: 'error' });
        
        const cost = 1000;
        if (p.balance < cost) return socket.emit('message', { text: `Need ${cost} ODZ to compile kernel.`, type: 'error' });
        
        p.balance -= cost;
        p.software.push({
            name: name,
            level: 1,
            power: 1, // Start weak
            stealth: 1,
            type: 'brute'
        });
        
        await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: `Virus '${name}' compiled successfully.`, type: 'success' });
    }
    
    // UPGRADE VIRUS
    else if (action === 'upgrade') {
        const name = args[1];
        const stat = args[2]; // 'power' or 'stealth'
        
        if (!name || !['power', 'stealth'].includes(stat)) {
            return socket.emit('message', { text: 'Usage: virus upgrade [name] [power/stealth]', type: 'error' });
        }
        
        const vIndex = p.software.findIndex(s => s.name === name);
        if (vIndex === -1) return socket.emit('message', { text: 'Virus not found.', type: 'error' });
        
        const vir = p.software[vIndex];
        const cost = vir.level * 500;
        
        if (p.balance < cost) return socket.emit('message', { text: `Upgrade costs ${cost} ODZ.`, type: 'error' });
        
        p.balance -= cost;
        vir.level++;
        if (stat === 'power') vir.power += 1;
        if (stat === 'stealth') vir.stealth += 1;
        
        // Mongoose array update requirement
        p.markModified('software');
        await p.save();
        
        socket.emit('player_data', p);
        socket.emit('message', { text: `Upgraded ${name} to Level ${vir.level}.`, type: 'success' });
    }
    else {
        socket.emit('message', { text: "Use: virus list | virus create [name] | virus upgrade [name] [stat]", type: 'info' });
    }
}

module.exports = { handleBounty, handleVirus };
