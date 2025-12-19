const { SHOP_ITEMS } = require('./constants');

async function handleTheme(user, args, socket, Player) {
    const t = args[0];
    const valid = ['green', 'amber', 'plasma', 'matrix', 'red'];
    let p = await Player.findOne({ username: user });

    if (!t) {
        return socket.emit('message', { 
            text: `Available Themes: ${valid.join(', ')}\nUsage: theme [name]`, 
            type: 'info' 
        });
    }

    if (valid.includes(t)) {
        // 'green' is default, others need to be owned
        if (t !== 'green' && !p.inventory.includes(`theme_${t}`)) {
            return socket.emit('message', { 
                text: `ACCESS DENIED. Theme protocol '${t}' not found in local storage. Purchase required.`, 
                type: 'error' 
            });
        }
        
        p.theme = t; 
        await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { 
            text: `INTERFACE RELOADED. Visual Matrix set to: ${t.toUpperCase()}`, 
            type: 'success' 
        });
    } else {
        socket.emit('message', { text: `Error: Theme '${t}' is invalid or corrupted.`, type: 'error' });
    }
}

async function handleStatus(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    socket.emit('player_data', p);
    
    const statusMsg = `
=== SYSTEM STATUS ===
USER     : ${p.username}
LEVEL    : ${p.level} [${p.xp} XP]
BALANCE  : ${p.balance} ODZ
BANK     : ${p.bankBalance || 0} ODZ
HARDWARE : CPU v${p.hardware.cpu} | GPU v${p.hardware.gpu} | RAM ${p.hardware.ram}GB
SECURITY : Firewall v${p.security.firewall} | Honeypot: ${p.security.honeypot ? 'ACTIVE' : 'OFFLINE'}
REPUTATION: ${p.reputation}
BOUNTY   : ${p.bounty > 0 ? p.bounty + ' ODZ (WARNING: ACTIVE)' : 'None'}
`;
    socket.emit('message', { text: statusMsg, type: 'info' });
}

async function handleLeaderboard(socket, Player) {
    const all = await Player.find();
    // Filter out cloaked players
    const visible = all.filter(pl => !pl.inventory.includes('cloak_v1'));
    const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
    
    let msg = "\n=== GLOBAL HACKER RANKINGS ===\n";
    top.forEach((pl, i) => {
        msg += `[#${i+1}] ${pl.username.padEnd(12)} | ${pl.balance} ODZ\n`;
    });
    
    socket.emit('message', { text: msg, type: 'info' });
}

async function handleHelp(socket) {
    // This might be handled by frontend, but good to have backend backup or dynamic help
    // For now, we'll leave it to frontend or implement if needed.
}

module.exports = { handleTheme, handleStatus, handleLeaderboard };
