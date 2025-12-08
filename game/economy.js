// game/economy.js
const { SHOP_ITEMS, LEVEL_XP_REQ, BASE_MINE_COOLDOWN, MINE_DURATION, MINE_TICK } = require('./constants'); // We will make constants.js next

const ACTIVE_MINERS = new Set();

function getCooldown(p) { 
    return Math.max(5000, BASE_MINE_COOLDOWN * (1 - (p.networkLevel - 1) * 0.1)); 
}

// --- MINING ---
async function handleMine(user, socket, Player) {
    if (!user || ACTIVE_MINERS.has(user)) return;
    
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    const cd = getCooldown(p);
    
    if (now - p.lastMine < cd) {
        const wait = Math.ceil((cd - (now - p.lastMine))/1000);
        return socket.emit('message', { text: `System Overheated. Cooling down... (${wait}s)`, type: 'warning' });
    }

    ACTIVE_MINERS.add(user);
    socket.emit('message', { text: `[MINER v${p.cpuLevel}.0] Cycle started (${MINE_DURATION/1000}s)...`, type: 'system' });
    socket.emit('play_sound', 'click');

    let ticks = 0;
    const totalTicks = MINE_DURATION / MINE_TICK;

    const interval = setInterval(async () => {
        // Re-fetch player to ensure balance is current if they did other stuff
        // p = await Player.findOne({ username: user }); 
        if (!ACTIVE_MINERS.has(user)) { clearInterval(interval); return; }
        
        ticks++;
        const amt = (Math.floor(Math.random()*5)+5) * p.cpuLevel;
        
        // Atomic update for safety
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
            
            // Level Up Check
            if (p.xp >= p.level * LEVEL_XP_REQ) {
                p.level++;
                p.xp = 0;
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
    for (const [id, item] of Object.entries(SHOP_ITEMS)) {
        msg += `[${id.padEnd(14)}] ${item.price} ODZ - ${item.desc}\n`;
    }
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleBuy(user, args, socket, Player) {
    const id = args[0];
    const item = SHOP_ITEMS[id];
    
    if (!item) return socket.emit('message', { text: 'Item not found.', type: 'error' });
    
    let p = await Player.findOne({ username: user });
    if (p.balance < item.price) return socket.emit('message', { text: 'Insufficient Funds.', type: 'error' });

    // Inventory Limit
    const count = p.inventory.filter(i => i === id).length;
    if (item.type !== 'upgrade' && item.type !== 'skin' && count >= 2) {
        return socket.emit('message', { text: 'Inventory Limit (Max 2).', type: 'error' });
    }

    p.balance -= item.price;

    if (item.type === 'upgrade') {
        if (p[item.stat] >= item.val) return socket.emit('message', { text: 'Upgrade already installed.', type: 'error' });
        p[item.stat] = item.val;
        socket.emit('message', { text: `Hardware Installed: ${id}`, type: 'success' });
    } else if (id === 'honeypot') {
        p.activeHoneypot = true;
        socket.emit('message', { text: 'Honeypot Trap ARMED.', type: 'special' });
    } else {
        if (item.type === 'skin') p.theme = item.val;
        else p.inventory.push(id);
        socket.emit('message', { text: `Purchased: ${id}`, type: 'success' });
    }

    await p.save();
    socket.emit('player_data', p);
    socket.emit('play_sound', 'success');
}

// --- DAILY ---
async function handleDaily(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    const now = Date.now();
    
    if (now - p.lastDaily < 86400000) {
        const hours = Math.ceil((86400000 - (now - p.lastDaily)) / 3600000);
        return socket.emit('message', { text: `Reward claimed. Available in ${hours}h.`, type: 'error' });
    }

    let reward = 100 * p.level;
    
    // Top 5 Bonus Check
    const top5 = await Player.find().sort({ balance: -1 }).limit(5);
    if (top5.some(x => x.username === user)) {
        reward += 500;
        socket.emit('message', { text: `ELITE HACKER BONUS: +500 ODZ`, type: 'special' });
    }

    p.balance += reward;
    p.lastDaily = now;
    await p.save();
    
    socket.emit('player_data', p);
    socket.emit('message', { text: `Daily Login: +${reward} ODZ`, type: 'success' });
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

module.exports = { handleMine, handleShop, handleBuy, handleDaily, handleTransfer };