// game/economy.js
const { SHOP_ITEMS, LEVEL_XP_REQ, MINE_DURATION, MINE_TICK } = require('./constants'); 

const ACTIVE_MINERS = new Set();

function getMiningYield(player) {
    // Base Calculation: (Random 5-10) * CPU Level
    let base = Math.floor(Math.random() * 5) + 5;
    let multiplier = player.hardware.cpu || 1;
    
    // Server Rack Bonus (Small boost to active mining)
    if (player.hardware.servers > 0) {
        multiplier += (player.hardware.servers * 0.2); 
    }
    
    return Math.floor(base * multiplier);
}

// --- MINING ---
async function handleMine(user, socket, Player) {
    if (!user || ACTIVE_MINERS.has(user)) return;
    
    let p = await Player.findOne({ username: user });
    
    // Cooldown Logic
    const now = Date.now();
    const baseCd = 20000;
    const reduction = ((p.hardware.networkLevel || 1) - 1) * 2000; 
    const actualCd = Math.max(5000, baseCd - reduction);
    
    if (now - p.lastMine < actualCd) {
        const wait = Math.ceil((actualCd - (now - p.lastMine))/1000);
        return socket.emit('message', { text: `System Overheated. Cooling down... (${wait}s)`, type: 'warning' });
    }

    ACTIVE_MINERS.add(user);
    socket.emit('message', { text: `[MINER v${p.hardware.cpu}.0] Cycle started...`, type: 'system' });
    socket.emit('play_sound', 'click');

    let ticks = 0;
    const totalTicks = MINE_DURATION / MINE_TICK;

    const interval = setInterval(async () => {
        if (!ACTIVE_MINERS.has(user)) { clearInterval(interval); return; }
        
        ticks++;
        const amt = getMiningYield(p);
        
        p = await Player.findOneAndUpdate(
            { username: user }, 
            { $inc: { balance: amt, xp: 10 } }, 
            { new: true }
        );

        socket.emit('message', { text: `>> Chunk ${ticks}/${totalTicks}: +${amt} ODZ`, type: 'success' });
        socket.emit('play_sound', 'coin');

        if (ticks >= totalTicks) {
            clearInterval(interval);
            ACTIVE_MINERS.delete(user);
            p.lastMine = Date.now();
            
            if (p.xp >= p.level * LEVEL_XP_REQ) {
                p.level++; p.xp = 0;
                socket.emit('message', { text: `*** SYSTEM UPGRADE: LEVEL ${p.level} ***`, type: 'special' });
                socket.emit('play_sound', 'success');
            }
            
            await p.save();
            socket.emit('player_data', p);
            socket.emit('message', { text: 'Mining Cycle Complete.', type: 'info' });
        }
    }, MINE_TICK);
}

// --- SHOP ---
function handleShop(socket) {
    let msg = "\n=== BLACK MARKET ===\n";
    const groups = { 'Hardware': [], 'Software': [], 'Security': [], 'Cosmetic': [] };
    
    for (const [id, item] of Object.entries(SHOP_ITEMS)) {
        let cat = 'Software';
        if (item.type === 'hardware' || item.type === 'infrastructure') cat = 'Hardware';
        if (item.type === 'security') cat = 'Security';
        if (item.type === 'skin') cat = 'Cosmetic';
        
        groups[cat].push(`[${id.padEnd(14)}] ${item.price} ODZ - ${item.desc} [${item.rarity.toUpperCase()}]`);
    }

    for (const [cat, items] of Object.entries(groups)) {
        if (items.length > 0) {
            msg += `\n-- ${cat.toUpperCase()} --\n${items.join('\n')}\n`;
        }
    }
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleBuy(user, args, socket, Player) {
    const id = args[0];
    const item = SHOP_ITEMS[id];
    
    if (!item) return socket.emit('message', { text: 'Item not found.', type: 'error' });
    
    let p = await Player.findOne({ username: user });
    if (p.balance < item.price) return socket.emit('message', { text: 'Insufficient Funds.', type: 'error' });

    // Deduct Cost
    p.balance -= item.price;

    // Apply Item
    if (item.type === 'hardware') {
        if (p.hardware[item.slot] >= item.val) {
             return socket.emit('message', { text: 'Better hardware already installed.', type: 'error' });
        }
        p.hardware[item.slot] = item.val;
        socket.emit('message', { text: `Hardware Installed: ${id} (Level ${item.val})`, type: 'success' });
    } 
    else if (item.type === 'infrastructure') {
        if (id === 'server_rack') {
            p.hardware.servers = (p.hardware.servers || 0) + 1;
            socket.emit('message', { text: `Server Node Added. Passive Income Increased.`, type: 'special' });
        }
    }
    else if (item.type === 'security') {
        p.security.firewall = Math.max(p.security.firewall, item.val);
        socket.emit('message', { text: `Security Upgrade: Firewall Level ${item.val}`, type: 'success' });
    }
    else if (item.type === 'skin') {
        p.theme = item.val;
        socket.emit('message', { text: `Theme Applied: ${item.val}`, type: 'success' });
    }
    else {
        const count = p.inventory.filter(i => i === id).length;
        if (count >= 2) return socket.emit('message', { text: 'Inventory Full (Max 2).', type: 'error' });
        p.inventory.push(id);
        socket.emit('message', { text: `Software Downloaded: ${id}`, type: 'success' });
    }

    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
}

// --- PASSIVE INCOME COLLECTION (New) ---
async function handleCollect(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    const serverCount = p.hardware.servers || 0;
    if (serverCount <= 0) {
        return socket.emit('message', { text: "No servers owned. Buy 'server_rack' in shop.", type: 'error' });
    }

    const now = Date.now();
    // Default to lastDaily if lastCollection is 0 (first time)
    const last = p.lastCollection || p.lastDaily || now;
    
    // Calculate minutes passed
    const diffMs = now - last;
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) {
        return socket.emit('message', { text: "Buffers empty. Accumulating crypto...", type: 'warning' });
    }

    // Rate: 10 ODZ per server per minute
    const rate = serverCount * 10;
    const earnings = minutes * rate;
    
    // Cap at 24 hours to prevent infinite offline scaling without login
    const maxEarnings = 1440 * rate; 
    const finalEarnings = Math.min(earnings, maxEarnings);

    p.balance += finalEarnings;
    p.lastCollection = now;
    
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `COLLECTED: ${finalEarnings} ODZ from Server Farm (${minutes} mins).`, type: 'success' });
    socket.emit('play_sound', 'coin');
}

// --- DAILY REWARD ---
async function handleDaily(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    
    if (now - p.lastDaily < 86400000) {
        const hours = Math.ceil((86400000 - (now - p.lastDaily)) / 3600000);
        return socket.emit('message', { text: `Reward claimed. Available in ${hours}h.`, type: 'error' });
    }

    let reward = 100 * p.level;
    p.balance += reward;
    p.lastDaily = now;
    await p.save();
    
    socket.emit('player_data', p);
    socket.emit('message', { text: `Daily Reward: +${reward} ODZ`, type: 'success' });
}

// --- TRANSFER ---
async function handleTransfer(user, args, socket, Player) {
    const target = args[0];
    const amount = parseInt(args[1]);
    
    if (!target || isNaN(amount) || amount <= 0) return socket.emit('message', { text: 'Usage: transfer [user] [amount]', type: 'error' });
    
    let p = await Player.findOne({ username: user });
    if (p.balance < amount) return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    
    const t = await Player.findOne({ username: target });
    if (!t) return socket.emit('message', { text: 'Target user not found.', type: 'error' });

    p.balance -= amount;
    t.balance += amount;
    
    t.inbox.push({ from: 'SYSTEM', msg: `Received ${amount} ODZ from ${user}.`, read: false });
    
    await p.save();
    await t.save();
    
    socket.emit('player_data', p);
    socket.emit('message', { text: `Transferred ${amount} ODZ to ${target}.`, type: 'success' });
}

module.exports = { handleMine, handleShop, handleBuy, handleDaily, handleTransfer, handleCollect };
