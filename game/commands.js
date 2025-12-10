// game/commands.js

// 1. IMPORT ALL MODULES
// We import every handler function we created in the other files
const { 
    handleMine, 
    handleShop, 
    handleBuy, 
    handleDaily, 
    handleTransfer, 
    handleCollect 
} = require('./economy');

const { 
    handleNetScan, 
    handleScan, 
    handleExploit, 
    handleShell, 
    handleBrute 
} = require('./hacking'); 

const { 
    handleCoinflip, 
    handleDice, 
    handleSlots 
} = require('./activities');

const { 
    handleMazeStart, 
    handleNavigate, 
    handleServerHackStart, 
    listJobs, 
    acceptJob, 
    handleDownload, 
    handleDefenseAction 
} = require('./missions');

const { 
    handleBounty, 
    handleVirus 
} = require('./blackmarket');

/**
 * Main Command Router
 * Receives every command sent from the frontend and decides what to do with it.
 */
async function handleSystem(user, command, args, socket, Player, io) {
    // Fetch player data to pass context
    let p = await Player.findOne({ username: user });
    if (!p) return; // Safety check
    
    // --- 1. SHELL INTERCEPT (CRITICAL) ---
    // This allows the Hacking Module to "hijack" commands like ls, cat, guess, crack
    // if the player is currently inside a hacked server shell.
    // If handleShell returns true, it means it handled the command, so we stop here.
    const handledByShell = await handleShell(user, command, args, socket, Player);
    if (handledByShell) return;

    // --- 2. STANDARD COMMAND ROUTING ---
    switch (command) {
        
        // ==========================================
        // SYSTEM & UTILITY COMMANDS
        // ==========================================
        
        case 'theme':
            const t = args[0];
            const validThemes = ['green', 'amber', 'plasma', 'matrix', 'red'];
            if (validThemes.includes(t)) {
                // Check if they own the theme (green is free)
                if (t !== 'green' && !p.inventory.includes(`theme_${t}`)) {
                    return socket.emit('message', { text: `Theme '${t}' is locked. Buy access in shop.`, type: 'error' });
                }
                p.theme = t; 
                await p.save();
                socket.emit('player_data', p);
                socket.emit('message', { text: `Visual Interface Updated: ${t.toUpperCase()}`, type: 'success' });
            } else {
                socket.emit('message', { text: 'Invalid theme. Try: green, amber, plasma, matrix', type: 'error' });
            }
            break;
        
        case 'chat':
            const msg = args.join(' ');
            if (msg) {
                // Broadcast to EVERYONE connected
                io.emit('message', { text: `[CHAT] ${user}: ${msg}`, type: 'info' });
            } else {
                socket.emit('message', { text: 'Usage: chat [message]', type: 'error' });
            }
            break;
            
        // Local File Management (Your own PC)
        // Note: Remote files are handled by handleShell intercept above
        case 'files':
        case 'ls':
            socket.emit('message', { text: `\n/ROOT (${p.files.length} files):\n${p.files.join('\n')}`, type: 'info' });
            break;

        case 'read':
        case 'cat':
            const f = args[0];
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
            // Renders the status text in the terminal
            socket.emit('player_data', p);
            socket.emit('message', { 
                text: `USER: ${p.username}\nLEVEL: ${p.level} (XP: ${p.xp})\nBALANCE: ${p.balance} ODZ\nCPU: v${p.hardware.cpu}.0 | GPU: v${p.hardware.gpu}.0 | RAM: ${p.hardware.ram}GB`, 
                type: 'success' 
            });
            break;

        case 'leaderboard':
            const all = await Player.find();
            // Filter out players using 'cloak_v1'
            const visible = all.filter(pl => !pl.inventory.includes('cloak_v1'));
            // Sort by cash
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
                const tName = args[1];
                if (!tName) return socket.emit('message', { text: 'Usage: mail send [user] [msg]', type: 'error' });
                
                const t = await Player.findOne({ username: tName });
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

        // ==========================================
        // ECONOMY MODULES
        // ==========================================
        case 'mine': await handleMine(user, socket, Player); break;
        case 'shop': handleShop(socket); break;
        case 'buy': await handleBuy(user, args, socket, Player); break;
        case 'daily': await handleDaily(user, socket, Player); break;
        case 'transfer': await handleTransfer(user, args, socket, Player); break;
        case 'collect': await handleCollect(user, socket, Player); break;

        // ==========================================
        // ACTIVITY / GAMBLING MODULES
        // ==========================================
        case 'flip':
        case 'coinflip': await handleCoinflip(user, args, Player, socket); break;
        case 'dice': await handleDice(user, args, Player, socket); break;
        case 'slots': await handleSlots(user, args, Player, socket); break;

        // ==========================================
        // HACKING MODULES (Standard)
        // ==========================================
        case 'netscan':
        case 'targets': await handleNetScan(user, socket, Player); break;

        case 'scan': await handleScan(user, args, socket, Player); break;
        case 'exploit': await handleExploit(user, args, socket, Player); break;
        
        // Tools
        case 'brute': await handleBrute(user, args, socket, Player); break;

        // Legacy/User Guidance
        case 'hack': 
             socket.emit('message', { text: "Protocol Updated.\n1. Use 'netscan' to find targets.\n2. Use 'scan [target]'.\n3. Use 'exploit [port]'.\n4. Once inside shell, use 'crack' to break PINs.", type: 'info' });
             break;

        // 'guess' and 'privesc' are usually handled by handleShell, 
        // but if user types them outside a shell, we give a hint.
        case 'guess':
        case 'privesc':
        case 'crack':
             socket.emit('message', { text: "No active shell session. Exploit a target first.", type: 'error' });
             break;

        // ==========================================
        // MISSION MODULES
        // ==========================================
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

        // ==========================================
        // PUZZLES (Mission Specific)
        // ==========================================
        case 'decrypt':
             if (p.missionProgress && p.missionProgress.stage === 2) { 
                 socket.puzzleAnswer = "OVERRIDE"; // Set answer for next solve command
                 socket.emit('message', { text: `[FIREWALL LOCK] Unscramble: "DERRVIEO"\nType: solve [answer]`, type: 'special' });
             } else {
                 socket.emit('message', { text: "No active encryption lock detected.", type: 'warning' });
             }
             break;

        case 'solve':
             // Check against in-memory puzzle answer (simple session storage on socket instance)
             if(socket.puzzleAnswer && args[0] && args[0].toUpperCase() === socket.puzzleAnswer) {
                 if(p.missionProgress && p.missionProgress.stage === 2) {
                     p.missionProgress.stage = 3; 
                     p.markModified('missionProgress');
                     await p.save();
                     socket.emit('message', { text: "FIREWALL BREACHED. Accessing internal network...\nType 'nav forward' to find the core.", type: 'success' });
                 }
                 socket.puzzleAnswer = null; // Clear puzzle
                 socket.emit('play_sound', 'success');
             } else {
                 socket.emit('message', { text: "Incorrect Answer.", type: 'error' });
             }
             break;

        // ==========================================
        // DEFAULT / UNKNOWN
        // ==========================================
        default:
            socket.emit('message', { text: `Unknown command: '${command}'. Type 'help'.`, type: 'error' });
    }
}

module.exports = { handleSystem };
