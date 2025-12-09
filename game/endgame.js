// game/endgame.js

const SERVER_COST = 1000000;
const PASSIVE_INCOME = 100;

async function handleBuyServer(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    if (p.inventory.includes('server_license')) {
        return socket.emit('message', { text: 'You already own a server.', type: 'error' });
    }
    if (p.balance < SERVER_COST) {
        return socket.emit('message', { text: `Insufficient Funds. Cost: ${SERVER_COST} ODZ`, type: 'error' });
    }

    p.balance -= SERVER_COST;
    p.inventory.push('server_license');
    await p.save();
    
    socket.emit('player_data', p);
    socket.emit('message', { 
        text: 'SERVER PURCHASED. Initializing "Oddztek Node"... \nPassive Income Activated.', 
        type: 'special' 
    });
}

// Simple passive income ticker (hook this into server.js loop or mine logic)
// For now, let's make it a claimable command to save server resources
async function handleCollectRent(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    if (!p.inventory.includes('server_license')) return socket.emit('message', { text: 'You do not own a server.', type: 'error' });
    
    const now = Date.now();
    // Claim every hour
    if (now - p.lastDaily < 3600000) { // Reusing lastDaily slot or make new one
        // ... logic
    }
}

module.exports = { handleBuyServer };