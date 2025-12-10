// game/commands.js
const { handleMine, handleShop, handleBuy, handleDaily, handleTransfer, handleCollect } = require('./economy');
const { handleScan, handleExploit, handleShell, handleNetScan, handleBrute } = require('./hacking'); 
const { handleCoinflip, handleDice, handleSlots } = require('./activities');
// NEW IMPORT:
const { handleVirus, handleBounty } = require('./blackmarket');
const { handleMazeStart, handleNavigate, handleServerHackStart, listJobs, acceptJob, handleDownload, handleDefenseAction } = require('./missions');

async function handleSystem(user, command, args, socket, Player, io) {
    let p = await Player.findOne({ username: user });
    if (!p) return;
    
    // --- 1. SHELL INTERCEPT ---
    const handledByShell = await handleShell(user, command, args, socket, Player);
    if (handledByShell) return;

    // --- 2. STANDARD COMMANDS ---
    switch (command) {
        // --- BLACK MARKET (FIXED) ---
        case 'virus': await handleVirus(user, args, socket, Player); break;
        case 'bounty': await handleBounty(user, args, socket, Player); break;

        // --- HACKING ---
        case 'netscan':
        case 'targets': await handleNetScan(user, socket, Player); break;
        case 'scan': await handleScan(user, args, socket, Player); break;
        case 'exploit': await handleExploit(user, args, socket, Player); break;
        case 'hack': 
             socket.emit('message', { text: "Protocol Updated. Use 'netscan' -> 'scan' -> 'exploit'.", type: 'info' });
             break;
        case 'brute': await handleBrute(user, args, socket, Player); break;

        // --- MISSIONS ---
        case 'jobs': listJobs(user, socket, Player); break;
        case 'accept': await acceptJob(user, args, socket, Player); break;
        case 'server_hack': await handleServerHackStart(user, socket, Player); break;
        case 'nav':
        case 'move': await handleNavigate(user, args, socket, Player); break;
        case 'download': await handleDownload(user, socket, Player); break;
        
        case 'block':
        case 'patch':
             await handleDefenseAction(user, command, socket, Player);
             break;

        // --- ECONOMY ---
        case 'mine': await handleMine(user, socket, Player); break;
        case 'shop': handleShop(socket); break;
        case 'buy': await handleBuy(user, args, socket, Player); break;
        case 'daily': await handleDaily(user, socket, Player); break;
        case 'transfer': await handleTransfer(user, args, socket, Player); break;
        case 'collect': await handleCollect(user, socket, Player); break;

        // --- ACTIVITIES ---
        case 'flip':
        case 'coinflip': await handleCoinflip(user, args, Player, socket); break;
        case 'dice': await handleDice(user, args, Player, socket); break;
        case 'slots': await handleSlots(user, args, Player, socket); break;

        // --- SYSTEM ---
        case 'theme':
            const t = args[0];
            const valid = ['green','amber','plasma','matrix','red'];
            if (valid.includes(t)) {
                if (t !== 'green' && !p.inventory.includes(`theme_${t}`)) {
                    return socket.emit('message', { text: `Theme '${t}' locked. Buy in shop.`, type: 'error' });
                }
                p.theme = t; await p.save();
                socket.emit('player_data', p);
                socket.emit('message', { text: `Visual Interface: ${t.toUpperCase()}`, type: 'success' });
            } else socket.emit('message', { text: 'Invalid theme.', type: 'error' });
            break;
        
        case 'chat':
            const msg = args.join(' ');
            if (msg) io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
            else socket.emit('message', { text: 'Usage: chat [message]', type: 'error' });
            break;
            
        case 'files':
        case 'ls':
            socket.emit('message', { text: `\n/ROOT (${p.files.length} files):\n${p.files.join('\n')}`, type: 'info' });
            break;

        case 'read':
        case 'cat':
            const f = args[0];
            if (p.files.includes(f)) socket.emit('message', { text: `\n> ${f}\n[DATA STREAM OPEN]`, type: 'system' });
            else socket.emit('message', { text: 'File not found.', type: 'error' });
            break;

        case 'inventory':
        case 'inv':
            socket.emit('message', { text: `INVENTORY: ${p.inventory.join(', ') || 'None'}`, type: 'info' });
            break;
        
        case 'status':
        case 'whoami':
            socket.emit('player_data', p);
            socket.emit('message', { 
                text: `USER: ${p.username}\nLEVEL: ${p.level}\nBALANCE: ${p.balance} ODZ`, 
                type: 'success' 
            });
            break;

        case 'leaderboard':
            const all = await Player.find();
            const visible = all.filter(pl => !pl.inventory.includes('cloak_v1'));
            const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
            socket.emit('message', { text: `\n=== LEADERBOARD ===\n${top.map((pl,i)=>`#${i+1} ${pl.username} | ${pl.balance}`).join('\n')}`, type: 'info' });
            break;

        case 'mail':
            const action = args[0];
            if (action === 'check') {
                if (!p.inbox.length) socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
                else socket.emit('message', { text: `\n=== INBOX ===\n${p.inbox.map((m,i)=>`[${i+1}] ${m.read?'(Read)':'(NEW)'} FROM: ${m.from}\n    "${m.msg}"`).join('\n')}`, type: 'info' });
            } 
            else if (action === 'send') {
                const param1 = args[1]; // target
                const param2 = args.slice(2).join(' '); // msg
                if (!param1 || !param2) return socket.emit('message', { text: 'Usage: mail send [user] [msg]', type: 'error' });
                const t = await Player.findOne({ username: param1 });
                if (!t) return socket.emit('message', { text: 'User not found.', type: 'error' });
                t.inbox.push({ from: user, msg: param2, read: false });
                await t.save();
                socket.emit('message', { text: 'Sent.', type: 'success' });
            }
            break;

        case 'invite':
            socket.emit('message', { text: `CODE: ${p.inviteCode}`, type: 'special' });
            break;

        // Puzzles
        case 'decrypt':
             if (p.missionProgress && p.missionProgress.stage === 2) { 
                 socket.puzzleAnswer = "OVERRIDE";
                 socket.emit('message', { text: `[FIREWALL LOCK] Unscramble: "DERRVIEO"\nType: solve [answer]`, type: 'special' });
             } else {
                 socket.emit('message', { text: "No active encryption.", type: 'warning' });
             }
             break;
        case 'solve':
             if(socket.puzzleAnswer && args[0].toUpperCase() === socket.puzzleAnswer) {
                 if(p.missionProgress && p.missionProgress.stage === 2) {
                     p.missionProgress.stage = 3; 
                     p.markModified('missionProgress');
                     await p.save();
                     socket.emit('message', { text: "ACCESS GRANTED. Type 'nav forward'.", type: 'success' });
                 }
                 socket.puzzleAnswer = null;
                 socket.emit('play_sound', 'success');
             } else socket.emit('message', { text: "Incorrect.", type: 'error' });
             break;

        default:
            socket.emit('message', { text: `Unknown command: '${command}'.`, type: 'error' });
    }
}

module.exports = { handleSystem };
