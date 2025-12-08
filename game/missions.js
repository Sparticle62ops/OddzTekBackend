// game/missions.js

const ACTIVE_MAZES = {}; // In-memory store for maze states
// { user: { map: [[],[]], x: 1, y: 1, exitX: 4, exitY: 4 } }

// --- HELPERS ---
function generateMaze(size) {
    // 0 = Path, 1 = Wall
    let map = Array(size).fill().map(() => Array(size).fill(1));
    let x = 1, y = 1;
    map[y][x] = 0; // Start
    
    // Random walk algorithm to carve path
    for(let i=0; i < size * 4; i++) {
        const dir = Math.floor(Math.random() * 4);
        if (dir === 0 && y > 1) y--;       // North
        else if (dir === 1 && y < size - 2) y++; // South
        else if (dir === 2 && x > 1) x--;       // West
        else if (dir === 3 && x < size - 2) x++; // East
        map[y][x] = 0;
    }
    
    // Ensure exit isn't start
    let exitX = x, exitY = y;
    if (exitX === 1 && exitY === 1) { exitX = size - 2; exitY = size - 2; map[exitY][exitX] = 0; }
    
    return { map, exitX, exitY };
}

// --- MAZE COMMANDS ---
function handleMazeStart(user, socket) {
    if (ACTIVE_MAZES[user]) {
        socket.emit('message', { text: 'Maze already active. Type "nav [n/s/e/w]".', type: 'warning' });
        return;
    }
    
    const size = 7; // 7x7 Grid
    const mazeData = generateMaze(size);
    ACTIVE_MAZES[user] = { ...mazeData, x: 1, y: 1 };
    
    socket.emit('message', { 
        text: `ENTERING LABYRINTH...\nGrid Size: ${size}x${size}\nStart: [1,1] | Target: [${mazeData.exitX},${mazeData.exitY}]\nType: nav [n/s/e/w]`, 
        type: 'special' 
    });
    socket.emit('play_sound', 'login');
}

async function handleNavigate(user, args, socket, Player) {
    const session = ACTIVE_MAZES[user];
    
    // Check if in Server Hack Mission
    const p = await Player.findOne({ username: user });
    if (p.missionProgress && p.missionProgress.active === 'mainframe') {
        // Delegate to Server Hack logic (below)
        return handleServerNav(user, args[0], socket, p);
    }

    if (!session) {
        socket.emit('message', { text: 'Not in a maze. Type "maze" to start.', type: 'error' });
        return;
    }

    const dir = args[0] ? args[0].toLowerCase() : null;
    let dx = 0, dy = 0;
    
    if (['n', 'north'].includes(dir)) dy = -1;
    else if (['s', 'south'].includes(dir)) dy = 1;
    else if (['e', 'east'].includes(dir)) dx = 1;
    else if (['w', 'west'].includes(dir)) dx = -1;
    else {
        socket.emit('message', { text: 'Usage: nav [n/s/e/w]', type: 'error' });
        return;
    }

    const newX = session.x + dx;
    const newY = session.y + dy;

    // Boundary & Wall Check
    if (newX < 0 || newY < 0 || newX >= session.map[0].length || newY >= session.map.length || session.map[newY][newX] === 1) {
        socket.emit('message', { text: 'PATH BLOCKED. Wall detected.', type: 'error' });
        socket.emit('play_sound', 'error');
    } else {
        session.x = newX;
        session.y = newY;
        
        if (session.x === session.exitX && session.y === session.exitY) {
            // Win
            delete ACTIVE_MAZES[user];
            p.balance += 75;
            p.xp += 50;
            await p.save();
            
            socket.emit('player_data', p);
            socket.emit('message', { text: `EXIT FOUND! Data extracted.\nReward: +75 ODZ, +50 XP`, type: 'success' });
            socket.emit('play_sound', 'success');
        } else {
            socket.emit('message', { text: `Moved to [${newX}, ${newY}]. Signal clear.`, type: 'info' });
        }
    }
}

// --- SERVER HACK CAMPAIGN ---
async function handleServerHackStart(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    // Requirements
    if (p.level < 2) return socket.emit('message', { text: 'Access Denied: Level 2 Required.', type: 'error' });
    if (p.cpuLevel < 2) return socket.emit('message', { text: 'Hardware Insufficient: CPU v2 Required.', type: 'error' });

    p.missionProgress = { active: 'mainframe', stage: 1 }; // Stage 1: Firewall
    await p.save();
    
    socket.emit('message', { 
        text: `[MISSION STARTED: OPERATION BLACKOUT]\nConnecting to Mainframe...\n> Connection Established.\n> WARNING: ICE Detected.\nType: 'nav forward' to approach firewall.`, 
        type: 'special' 
    });
    socket.emit('play_sound', 'hack');
}

async function handleServerNav(user, dir, socket, p) {
    // Stage 1: Firewall Approach
    if (p.missionProgress.stage === 1) {
        if (['forward', 'n', 'north'].includes(dir)) {
            socket.emit('message', { text: `[FIREWALL ENCOUNTER]\nEncryption Key Required.\nType 'decrypt' to break the lock.`, type: 'warning' });
            p.missionProgress.stage = 1.5; // Ready to decrypt
            await p.save();
        } else {
            socket.emit('message', { text: "Path blocked. Only 'forward' is valid.", type: 'error' });
        }
    } else if (p.missionProgress.stage === 2) {
        // Post-Firewall (Placeholder for Phase 3 expansion)
        socket.emit('message', { text: "You are inside the mainframe. (Further levels under construction)", type: 'info' });
    }
}

module.exports = { handleMazeStart, handleNavigate, handleServerHackStart };