// game/commands.js
const { handleMine, handleShop, handleBuy, handleDaily, handleTransfer } = require('./economy');
const { handleScan, handleExploit, handleShell } = require('./hacking'); 
const { handleCoinflip, handleDice, handleSlots } = require('./activities');
// Ensure handleDefenseAction is exported from missions.js before using
const { handleMazeStart, handleNavigate, handleServerHackStart, listJobs, acceptJob, handleDownload, handleDefenseAction } = require('./missions');

async function handleSystem(user, command, args, socket, Player, io) {
    let p = await Player.findOne({ username: user });
    
    // --- 1. SHELL INTERCEPT (For Active Hacking Sessions) ---
    // If handleShell returns true, it consumed the command (ls, cd, cat in remote system)
    // Note: We prioritize shell commands only if a session exists
    const handledByShell = await handleShell(user, command, args, socket, Player);
    if (handledByShell) return;

    // --- 2. STANDARD COMMANDS ---
    switch (command) {
        // --- SYSTEM UTILITIES ---
        case 'theme':
            const t = args[0];
            if (['green','amber','plasma','matrix','red'].includes(t)) {
                // Check for Premium Themes
                if (t !== 'green' && !p.inventory.includes(`theme_${t}`)) {
                    return socket.emit('message', { text: `Theme '${t}' is locked. Buy in shop.`, type: 'error' });
                }
                p.theme = t; 
                await p.save();
                socket.emit('player_data', p);
                socket.emit('message', { text: `Visual Interface Updated: ${t.toUpperCase()}`, type: 'success' });
            } else {
                socket.emit('message', { text: 'Invalid theme. Available: green, amber, plasma, matrix, red', type: 'error' });
            }
            break;
        
        case 'chat':
            const msg = args.join(' ');
            if (msg) io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
            else socket.emit('message', { text: 'Usage: chat [message]', type: 'error' });
            break;
            
        case 'files':
        case 'ls': // Local file list alias
            socket.emit('message', { text: `\n/ROOT (${p.files.length} files):\n${p.files.join('\n')}`, type: 'info' });
            break;

        case 'read':
            const f = args[0];
            // Define Lore locally or import constants
            const LORE = {
                'readme.txt': "Welcome to Oddztek OS. This system is monitored. Unauthorized access is prohibited.",
                'server_log.txt': "FATAL ERROR 10-12-99: Core temperature critical. Automatic shutdown failed.",
                'user_data.txt': "User List: Admin, Guest, System...",
                'wallet.dat': "Encrypted Wallet File. (Decrypted: +500 ODZ)",
                'sys_core.log': "System Core Dump: Root Access trace found.",
                'server_log_01.txt': "Sector 7 failure. Containment breach imminent."
            };
            
            if (p.files.includes(f)) {
                const content = LORE[f] || "[FILE ENCRYPTED OR CORRUPTED]";
                socket.emit('message', { text: `\n> ${f}\n${content}`, type: 'system' });
            } else {
                socket.emit('message', { text: 'File not found in local storage.', type: 'error' });
            }
            break;

        case 'inventory':
        case 'inv':
            socket.emit('message', { text: `INSTALLED MODULES: ${p.inventory.join(', ') || 'None'}`, type: 'info' });
            break;
        
        case 'status':
        case 'whoami':
            socket.emit('player_data', p);
            socket.emit('message', { 
                text: `USER: ${p.username}\nLEVEL: ${p.level}\nBALANCE: ${p.balance} ODZ\nCPU: v${p.hardware.cpu}.0 | GPU: v${p.hardware.gpu}.0 | RAM: ${p.hardware.ram}GB`, 
                type: 'success' 
            });
            break;

        case 'leaderboard':
            const all = await Player.find();
            const visible = all.filter(pl => !pl.inventory.includes('cloak_v1'));
            const top = visible.sort((a, b) => b.balance - a.balance).slice(0, 5);
            socket.emit('message', { text: `\n=== TOP HACKERS ===\n${top.map((pl,i)=>`#${i+1} ${pl.username} | ${pl.balance} ODZ`).join('\n')}`, type: 'info' });
            break;

        case 'mail':
            const action = args[0];
            if (action === 'check') {
                if (!p.inbox.length) socket.emit('message', { text: 'Inbox Empty.', type: 'info' });
                else socket.emit('message', { text: `\n=== SECURE INBOX ===\n${p.inbox.map((m,i)=>`[${i+1}] ${m.read?'(Read)':'(NEW)'} FROM: ${m.from}\n    "${m.msg}"`).join('\n')}`, type: 'info' });
            } 
            else if (action === 'send') {
                const t = await Player.findOne({ username: args[1] });
                if (!t) return socket.emit('message', { text: 'User not found.', type: 'error' });
                const messageBody = args.slice(2).join(' ');
                if (!messageBody) return socket.emit('message', { text: 'Message empty.', type: 'error' });
                
                t.inbox.push({ from: user, msg: messageBody, read: false, date: new Date() });
                await t.save();
                socket.emit('message', { text: 'Transmission Sent.', type: 'success' });
            } 
            else if (action === 'read') {
                const idx = parseInt(args[1]) - 1;
                if(p.inbox[idx]) { 
                    p.inbox[idx].read = true; 
                    await p.save(); 
                    socket.emit('message', { text: 'Message marked as read.', type: 'success' }); 
                } else {
                    socket.emit('message', { text: 'Invalid Message ID.', type: 'error' });
                }
            }
            else {
                socket.emit('message', { text: 'Usage: mail check | mail send [user] [msg] | mail read [id]', type: 'error' });
            }
            break;

        case 'invite':
            socket.emit('message', { text: `REFERRAL CODE: ${p.inviteCode}\n(Bonus: +100 ODZ for new user, +200 ODZ for you)`, type: 'special' });
            break;

        // --- ECONOMY MODULES ---
        case 'mine': await handleMine(user, socket, Player); break;
        case 'shop': handleShop(socket); break;
        case 'buy': await handleBuy(user, args, socket, Player); break;
        case 'daily': await handleDaily(user, socket, Player); break;
        case 'transfer': await handleTransfer(user, args, socket, Player); break;

        // --- ACTIVITY MODULES ---
        case 'flip':
        case 'coinflip': await handleCoinflip(user, args, Player, socket); break;
        case 'dice': await handleDice(user, args, Player, socket); break;
        case 'slots': await handleSlots(user, args, Player, socket); break;

        // --- HACKING MODULES (NEW SYSTEM) ---
        case 'scan': await handleScan(user, args, socket, Player); break;
        case 'exploit': await handleExploit(user, args, socket, Player); break;
        
        // 'privesc', 'ls', 'cat' are handled by handleShell intercept above
        // We keep 'hack' here for legacy or specific missions if needed, 
        // but the new system relies on 'scan' -> 'exploit'.
        case 'hack': 
             // Redirect to Scan prompt or explain new system
             socket.emit('message', { text: "Legacy Protocol. Use 'scan [target]' then 'exploit [port]'.", type: 'info' });
             break;

        case 'brute': 
             // Tool for cracking FTP/SSH in new system?
             // Or keep old logic? Let's point to new system help.
             socket.emit('message', { text: "Brute Force is now an automatic module used during 'exploit'.", type: 'info' });
             break;

        // --- MISSION MODULES ---
        case 'jobs': listJobs(user, socket, Player); break;
        case 'accept': await acceptJob(user, args, socket, Player); break;
        
        case 'server_hack': await handleServerHackStart(user, socket, Player); break;
        case 'nav':
        case 'move': await handleNavigate(user, args, socket, Player); break;
        case 'download': await handleDownload(user, socket, Player); break;
        
        // Defense Mission Commands
        case 'block':
        case 'patch':
             await handleDefenseAction(user, command, socket, Player);
             break;

        // Puzzles (Legacy or Mission specific)
        case 'decrypt':
             if (p.missionProgress && p.missionProgress.stage === 2) { // Stage 2 = Firewall
                 socket.puzzleAnswer = "OVERRIDE";
                 socket.emit('message', { text: `[FIREWALL LOCK] Unscramble: "DERRVIEO"\nType: solve [answer]`, type: 'special' });
             } else {
                 socket.emit('message', { text: "No active encryption lock detected.", type: 'warning' });
             }
             break;
        case 'solve':
             if(socket.puzzleAnswer && args[0].toUpperCase() === socket.puzzleAnswer) {
                 if(p.missionProgress && p.missionProgress.stage === 2) {
                     p.missionProgress.stage = 3; await p.save();
                     socket.emit('message', { text: "FIREWALL BREACHED. Accessing internal network...\nType 'nav forward' to find the core.", type: 'success' });
                 }
                 socket.puzzleAnswer = null;
                 socket.emit('play_sound', 'success');
             } else socket.emit('message', { text: "Incorrect.", type: 'error' });
             break;

        default:
            socket.emit('message', { text: `Unknown command: '${command}'. Type 'help'.`, type: 'error' });
    }
}

module.exports = { handleSystem };
