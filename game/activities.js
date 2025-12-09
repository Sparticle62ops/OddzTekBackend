// game/activities.js

/**
 * Handles minigames and gambling activities.
 * Implements tension delays (spinners/progress bars).
 */

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- COINFLIP ---
async function handleCoinflip(user, args, Player, socket) {
    const side = args[0] ? args[0].toLowerCase() : null;
    const amountStr = args[1];

    if (!side || !['heads', 'tails', 'h', 't'].includes(side)) {
        return socket.emit('message', { text: 'Usage: flip [heads/tails] [amount]', type: 'error' });
    }
    
    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount <= 0) {
        return socket.emit('message', { text: 'Invalid wager amount.', type: 'error' });
    }

    let p = await Player.findOne({ username: user });
    if (!p) return;

    if (p.balance < amount) {
        return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    }

    // Deduct entry cost immediately (prevents exploit during delay)
    p.balance -= amount;
    await p.save();
    socket.emit('player_data', p);

    // --- TENSION BUILDER ---
    // Sends a 'loading' message which the frontend renders as a spinning animation
    socket.emit('message', { text: `Flipping coin for ${amount} ODZ`, type: 'loading' });
    
    // Wait 2 seconds
    await delay(2000);

    // --- RESULT ---
    const result = Math.random() > 0.5 ? 'heads' : 'tails';
    const choice = (side === 'h') ? 'heads' : (side === 't') ? 'tails' : side;
    const win = (choice === result);

    if (win) {
        const winnings = amount * 2;
        p.balance += winnings;
        p.winsFlip = (p.winsFlip || 0) + 1;
        
        socket.emit('message', { text: `Result: ${result.toUpperCase()}. YOU WON +${winnings} ODZ!`, type: 'success' });
        socket.emit('play_sound', 'success');
    } else {
        p.lossesFlip = (p.lossesFlip || 0) + 1;
        
        socket.emit('message', { text: `Result: ${result.toUpperCase()}. You lost ${amount} ODZ.`, type: 'error' });
        socket.emit('play_sound', 'error');
    }

    await p.save();
    socket.emit('player_data', p);
}

// --- DICE ROLL ---
async function handleDice(user, args, Player, socket) {
    const guess = parseInt(args[0]);
    const amount = parseInt(args[1]);

    if (isNaN(guess) || guess < 1 || guess > 6) {
        return socket.emit('message', { text: 'Usage: dice [1-6] [amount]', type: 'error' });
    }
    if (isNaN(amount) || amount <= 0) {
        return socket.emit('message', { text: 'Invalid wager.', type: 'error' });
    }

    let p = await Player.findOne({ username: user });
    if (p.balance < amount) {
        return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    }

    p.balance -= amount;
    await p.save();
    socket.emit('player_data', p);

    // TENSION
    socket.emit('message', { text: "Rolling dice", type: 'loading' });
    await delay(1500);

    const roll = Math.floor(Math.random() * 6) + 1;
    
    if (roll === guess) {
        const winnings = amount * 5; // 5x Payout
        p.balance += winnings;
        socket.emit('message', { text: `Rolled: [ ${roll} ]. JACKPOT! Won +${winnings} ODZ!`, type: 'special' });
        socket.emit('play_sound', 'success');
    } else {
        socket.emit('message', { text: `Rolled: [ ${roll} ]. You lost ${amount} ODZ.`, type: 'error' });
        socket.emit('play_sound', 'error');
    }

    await p.save();
    socket.emit('player_data', p);
}

// --- SLOTS ---
async function handleSlots(user, args, Player, socket) {
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount <= 0) {
        return socket.emit('message', { text: 'Usage: slots [amount]', type: 'error' });
    }

    let p = await Player.findOne({ username: user });
    if (p.balance < amount) {
        return socket.emit('message', { text: 'Insufficient funds.', type: 'error' });
    }

    p.balance -= amount;
    await p.save();
    socket.emit('player_data', p);

    // TENSION
    socket.emit('message', { text: "Spinning reels", type: 'loading' });
    await delay(2000);

    const icons = ['🍒', '🍋', '🔔', '💎', '7️⃣'];
    const r1 = icons[Math.floor(Math.random() * icons.length)];
    const r2 = icons[Math.floor(Math.random() * icons.length)];
    const r3 = icons[Math.floor(Math.random() * icons.length)];

    const spinResult = `[ ${r1} | ${r2} | ${r3} ]`;
    let winnings = 0;
    let msgType = 'info';

    if (r1 === r2 && r2 === r3) {
        // Jackpot
        if (r1 === '7️⃣') winnings = amount * 50;
        else if (r1 === '💎') winnings = amount * 20;
        else winnings = amount * 10;
        msgType = 'special';
    } else if (r1 === r2 || r2 === r3 || r1 === r3) {
        // Pair
        winnings = Math.floor(amount * 1.5);
        msgType = 'success';
    }

    if (winnings > 0) {
        p.balance += winnings;
        socket.emit('message', { text: `${spinResult} WINNER! +${winnings} ODZ`, type: msgType });
        socket.emit('play_sound', 'success');
    } else {
        socket.emit('message', { text: `${spinResult} Loss.`, type: 'error' });
    }

    await p.save();
    socket.emit('player_data', p);
}

module.exports = { handleCoinflip, handleDice, handleSlots };