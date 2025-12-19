const { handleMine, handleShop, handleBuy, handleDaily, handleTransfer, handleCollect, handleBank } = require('./economy');
const { handleCraft } = require('./crafting');
const { handleAuction } = require('./auction');
const { handleScan, handleExploit, handleShell, handleNetScan, handleBrute, handleProbe, handleInject, handleDisconnect } = require('./hacking'); 
const { handleCoinflip, handleDice, handleSlots } = require('./activities');
const { handleVirus, handleBounty } = require('./blackmarket');
const { listJobs, acceptJob, handleServerHackStart, handleMazeStart, handleNavigate, handleDownload, handleDefenseAction } = require('./missions');
const { handleTheme, handleStatus, handleLeaderboard } = require('./system');
const { handleChat, handleInvite, handleMail } = require('./social');
const { handleFiles, handleInventory } = require('./filesystem');

async function handleSystem(user, command, args, socket, Player, io, Auction) {
    let p = await Player.findOne({ username: user });
    if (!p) return;
    
    // --- 1. SHELL INTERCEPT (Hacking Context) ---
    // If inside a hacked shell, these commands take priority
    const handledByShell = await handleShell(user, command, args, socket, Player);
    if (handledByShell) return;

    // --- 2. GLOBAL COMMANDS ---
    switch (command) {
        // --- SYSTEM & UTILS ---
        case 'theme': await handleTheme(user, args, socket, Player); break;
        case 'status':
        case 'whoami': await handleStatus(user, socket, Player); break;
        case 'leaderboard': await handleLeaderboard(socket, Player); break;
        
        // --- SOCIAL ---
        case 'chat': await handleChat(user, args, socket, io); break;
        case 'mail': await handleMail(user, args, socket, Player); break;
        case 'invite': await handleInvite(user, socket, Player); break;

        // --- FILES & INVENTORY ---
        case 'ls':
        case 'files':
        case 'cat':
        case 'read':
             await handleFiles(user, command, args, socket, Player); 
             break;
        case 'inv':
        case 'inventory': await handleInventory(user, socket, Player); break;

        // --- ECONOMY ---
        case 'mine': await handleMine(user, socket, Player); break;
        case 'shop': handleShop(socket); break;
        case 'buy': await handleBuy(user, args, socket, Player); break;
        case 'daily': await handleDaily(user, socket, Player); break;
        case 'transfer': await handleTransfer(user, args, socket, Player); break;
        case 'collect': await handleCollect(user, socket, Player); break;
        case 'bank': await handleBank(user, args, socket, Player); break;
        case 'craft':
        case 'combine': await handleCraft(user, args, socket, Player); break;
        case 'auction': await handleAuction(user, args, socket, Player, Auction); break;

        // --- HACKING ---
        case 'netscan':
        case 'targets': await handleNetScan(user, socket, Player); break;
        case 'scan': await handleScan(user, args, socket, Player); break;
        case 'exploit': await handleExploit(user, args, socket, Player); break;
        case 'brute': await handleBrute(user, args, socket, Player); break;
        case 'probe': await handleProbe(user, args, socket, Player); break;
        case 'inject': await handleInject(user, args, socket, Player); break;
        case 'dc':
        case 'disconnect': await handleDisconnect(user, socket, Player); break;
        case 'hack': 
             // Legacy/Shortcut: if target provided, treat as scan, else netscan
             if (args[0]) await handleScan(user, args, socket, Player);
             else await handleNetScan(user, socket, Player);
             break;

        // --- BLACK MARKET ---
        case 'virus': await handleVirus(user, args, socket, Player); break;
        case 'bounty': await handleBounty(user, args, socket, Player); break;

        // --- MISSIONS ---
        case 'jobs': listJobs(user, socket, Player); break;
        case 'accept': await acceptJob(user, args, socket, Player); break;
        case 'mission': 
             // 'mission start' or 'mission abort'
             if (args[0] === 'start') await handleServerHackStart(user, socket, Player);
             else if (args[0] === 'abort') {
                 p.missionProgress = {}; await p.save();
                 socket.emit('message', { text: 'Mission aborted.', type: 'info' });
             }
             break;
        case 'nav':
        case 'move': await handleNavigate(user, args, socket, Player); break;
        case 'download': await handleDownload(user, socket, Player); break;
        case 'block':
        case 'patch': await handleDefenseAction(user, command, socket, Player); break;

        // --- ACTIVITIES ---
        case 'flip':
        case 'coinflip': await handleCoinflip(user, args, Player, socket); break;
        case 'dice': await handleDice(user, args, Player, socket); break;
        case 'slots': await handleSlots(user, args, Player, socket); break;

        // --- PUZZLE/QUEST (Legacy or New) ---
        case 'unlock':
             // Can be moved to filesystem/hacking if it decrypts a wallet
             socket.emit('message', { text: "Use 'exploit' to crack systems. 'unlock' is for local encrypted files.", type: 'info' });
             break;

        default:
            socket.emit('message', { text: `Command not recognized: '${command}'. Type 'help' for manual.`, type: 'error' });
    }
}

module.exports = { handleSystem };
