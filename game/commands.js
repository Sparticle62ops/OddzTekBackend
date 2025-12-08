// game/commands.js
const { handleMine, handleShop, handleBuy, handleDaily, handleTransfer } = require('./economy');
const { handleScan, handleHackInit, handleGuess, handleBrute } = require('./hacking');
const { handleCoinflip, handleDice, handleSlots } = require('./activities'); // Added activities
const { handleMazeStart, handleNavigate, handleServerHackStart } = require('./missions');
const mongoose = require('mongoose');

// --- SYSTEM COMMANDS ---
async function handleSystem(user, command, args, socket, Player, io) {
    let p = await Player.findOne({ username: user });
    
    switch (command) {
        case 'theme':
            const t = args[0];
            if (['green','amber','plasma','matrix'].includes(t)) {
                if (t !== 'green' && !p.inventory.includes(`theme_${t}`)) {
                    return socket.emit('message', { text: 'Theme locked.', type: 'error' });
                }
                p.theme = t; await p.save();
                socket.emit('player_data', p);
                socket.emit('message', { text: `Theme set: ${t}`, type: 'success' });
            } else socket.emit('message', { text: 'Invalid theme.', type: 'error' });
            break;

        case 'chat':
            const msg = args.join(' ');
            if (msg) io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
            break;

        case 'files':
            socket.emit('message', { text: `\n/ROOT:\n${p.files.join('\n')}`, type: 'info' });
            break;

        case 'read':
            const f = args[0];
            const LORE = {
                'readme.txt': "Welcome to Oddztek OS. Authorized personnel only.",
                'server_log.txt': "CRITICAL FAILURE: Core systems offline.",
                'admin_pass.txt': "Hint: The password is hidden in the deep net."
            };
            if (p.files.includes(f) && LORE[f]) socket.emit('message', { text: `\n> ${f}\n${LORE[f]}`, type: 'system' });
            else socket.emit('message', { text: 'File corrupted/missing.', type: 'error' });
            break;

        case 'inventory':
        case 'inv':
            socket.emit('message', { text: `INVENTORY: ${p.inventory.join(', ') || 'Empty'}`, type: 'info' });
            break;

        case 'mail':
            const action = args[0];
            if (action === 'check') {
                if (!p.inbox.length) socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
                else socket.emit('message', { text: `\n=== INBOX ===\n${p.inbox.map((m,i)=>`[${i+1}] ${m.read?'(R)':'(N)'} ${m.from}: "${m.msg}"`).join('\n')}`, type: 'info' });
            } else if (action === 'send') {
                const t = await Player.findOne({ username: args[1] });
                if (!t) return socket.emit('message', { text: 'User not found.', type: 'error' });
                t.inbox.push({ from: user, msg: args.slice(2).join(' '), read: false });
                await t.save();
                socket.emit('message', { text: 'Sent.', type: 'success' });
            } else if (action === 'read') {
                const idx = parseInt(args[1]) - 1;
                if(p.inbox[idx]) { p.inbox[idx].read = true; await p.save(); socket.emit('message', { text: 'Marked read.', type: 'success' }); }
            }
            break;

        case 'leaderboard':
            const all = await Player.find();
            const visible = all.filter(pl => !pl.inventory.includes('cloak_v1'));
            const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
            socket.emit('message', { text: `\n=== TOP HACKERS ===\n${top.map((pl,i)=>`#${i+1} ${pl.username} | ${pl.balance}`).join('\n')}`, type: 'info' });
            break;

        // --- DELEGATE TO MODULES ---
        
        // Economy
        case 'mine': await handleMine(user, socket, Player); break;
        case 'shop': handleShop(socket); break;
        case 'buy': await handleBuy(user, args, socket, Player); break;
        case 'daily': await handleDaily(user, socket, Player); break;
        case 'transfer': await handleTransfer(user, args, socket, Player); break;

        // Activities (Gambling)
        case 'flip':
        case 'coinflip': await handleCoinflip(user, args, Player, socket); break;
        case 'dice': await handleDice(user, args, Player, socket); break;
        case 'slots': await handleSlots(user, args, Player, socket); break;

        // Hacking
        case 'scan': await handleScan(user, args, socket, Player); break;
        case 'hack': await handleHackInit(user, args, socket, Player); break;
        case 'guess': await handleGuess(user, args, socket, Player); break;
        case 'brute': await handleBrute(user, args, socket, Player); break;

        // Missions
        case 'maze': handleMazeStart(user, socket); break;
        case 'server_hack': await handleServerHackStart(user, socket, Player); break;
        case 'nav':
        case 'move': await handleNavigate(user, args, socket, Player); break;

        // Puzzles (Simplified logic here for now)
        case 'decrypt':
             // Check mission state inside decrypt
             if (p.missionProgress && p.missionProgress.stage === 1.5) {
                 socket.puzzleAnswer = "MAINFRAME";
                 socket.emit('message', { text: `[FIREWALL LOCK] Unscramble: "NARFIMAEM"\nType: solve [answer]`, type: 'special' });
             } else {
                 socket.puzzleAnswer = "CIPHER";
                 socket.emit('message', { text: `[PUZZLE] Unscramble: "EHCRIP"\nType: solve [answer]`, type: 'warning' });
             }
             break;
        case 'solve':
             if(socket.puzzleAnswer && args[0].toUpperCase() === socket.puzzleAnswer) {
                 if(p.missionProgress && p.missionProgress.stage === 1.5) {
                     p.missionProgress.stage = 2; await p.save();
                     socket.emit('message', { text: "ACCESS GRANTED. Entering Mainframe...", type: 'success' });
                 } else {
                     p.balance += 25; await p.save();
                     socket.emit('message', { text: "Correct. +25 ODZ", type: 'success' });
                 }
                 socket.puzzleAnswer = null;
             } else socket.emit('message', { text: "Incorrect.", type: 'error' });
             break;

        default:
            socket.emit('message', { text: `Unknown command: ${command}`, type: 'error' });
    }
}

module.exports = { handleSystem };