const { SHOP_ITEMS } = require('./constants');

const MISSIONS = [
    { id: 'job_01', title: 'Data Extraction: Omega', diff: 1, reward: 500, type: 'heist', desc: 'Infiltrate Omega Server and download user logs.' },
    { id: 'job_02', title: 'Sabotage: Rival Corp', diff: 2, reward: 1200, type: 'maze', desc: 'Navigate the firewall maze and plant a virus.' },
    { id: 'job_03', title: 'The Bank Job', diff: 4, reward: 5000, type: 'heist', desc: 'High security bank heist. Expert hackers only.' }
];

// Maze Layout (Simple 3x3 Grid for demo)
// 0,0  0,1  0,2
// 1,0  1,1  1,2
// 2,0  2,1  2,2
const MAZE_GRID = {
    '0,0': { desc: 'Entry Node. Safe.', exits: ['south', 'east'] },
    '0,1': { desc: 'Data Cache. Encrypted.', exits: ['west', 'east'] },
    '0,2': { desc: 'Firewall Hub.', exits: ['west', 'south'] },
    '1,0': { desc: 'Security Subsystem.', exits: ['north', 'south'] },
    '1,1': { desc: 'CORE ROUTER.', exits: ['north', 'south', 'east', 'west'] },
    '1,2': { desc: 'Trap Node.', exits: ['north'] },
    '2,0': { desc: 'Maintenance Port.', exits: ['north', 'east'] },
    '2,1': { desc: 'Admin Access Point.', exits: ['west', 'north'] }, // Target
    '2,2': { desc: 'Dead End.', exits: [] }
};

function listJobs(user, socket, Player) {
    let msg = "\n=== THE BROKER'S CONTRACTS ===\n";
    MISSIONS.forEach(m => {
        msg += `[${m.id}] ${m.title} | Diff: ${m.diff} | Pay: ${m.reward} ODZ\n    > ${m.desc}\n`;
    });
    msg += "\nType 'accept [id]' to sign contract.";
    socket.emit('message', { text: msg, type: 'info' });
}

async function acceptJob(user, args, socket, Player) {
    const jobId = args[0];
    const mission = MISSIONS.find(m => m.id === jobId);
    
    if (!mission) {
        return socket.emit('message', { text: 'Job ID not found.', type: 'error' });
    }
    
    let p = await Player.findOne({ username: user });
    if (p.missionProgress && p.missionProgress.active) {
        return socket.emit('message', { text: 'You already have an active mission. Finish or abort it.', type: 'warning' });
    }
    
    p.missionProgress = {
        active: true,
        id: mission.id,
        type: mission.type,
        stage: 0,
        data: { x: 0, y: 0 } // For maze
    };
    
    await p.save();
    socket.emit('message', { 
        text: `CONTRACT ACCEPTED: ${mission.title}\nObjective: ${mission.desc}\nType 'mission start' to begin operation.`, 
        type: 'success' 
    });
}

async function handleServerHackStart(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    if (!p.missionProgress || !p.missionProgress.active) {
        return socket.emit('message', { text: 'No active mission. Check "jobs".', type: 'error' });
    }
    
    if (p.missionProgress.type === 'heist') {
        socket.emit('message', { 
            text: "ESTABLISHING CONNECTION...\n[██████████] 100%\n\nConnected to Target System.\nUse 'netscan' then 'exploit' to breach security layers.", 
            type: 'special' 
        });
    } else if (p.missionProgress.type === 'maze') {
        handleMazeStart(user, socket, p);
    }
}

async function handleMazeStart(user, socket, p) {
    p.missionProgress.data = { x: 0, y: 0 };
    await p.save();
    
    socket.emit('message', { 
        text: `ENTERING NEURAL MAZE...\nLocation: [0,0] Entry Node.\nExits: SOUTH, EAST.\nUse 'nav [direction]' to move.`, 
        type: 'special' 
    });
}

async function handleNavigate(user, args, socket, Player) {
    let p = await Player.findOne({ username: user });
    if (!p.missionProgress || !p.missionProgress.active || p.missionProgress.type !== 'maze') {
        return socket.emit('message', { text: 'Not in a navigation sequence.', type: 'error' });
    }
    
    const dir = args[0] ? args[0].toLowerCase().charAt(0) : null; // n, s, e, w
    const { x, y } = p.missionProgress.data;
    const currentKey = `${x},${y}`;
    const node = MAZE_GRID[currentKey] || { exits: [] };
    
    let newX = x;
    let newY = y;
    let moved = false;
    
    if (dir === 'n' && node.exits.includes('north')) { newX--; moved = true; }
    if (dir === 's' && node.exits.includes('south')) { newX++; moved = true; }
    if (dir === 'e' && node.exits.includes('east')) { newY++; moved = true; }
    if (dir === 'w' && node.exits.includes('west')) { newY--; moved = true; }
    
    if (moved) {
        // Check bounds
        if (newX < 0 || newY < 0 || newX > 2 || newY > 2) {
             return socket.emit('message', { text: 'Connection Lost. (Out of bounds)', type: 'error' });
        }
        
        p.missionProgress.data = { x: newX, y: newY };
        await p.save();
        
        const nextKey = `${newX},${newY}`;
        const nextNode = MAZE_GRID[nextKey];
        
        socket.emit('message', { 
            text: `Moved to [${newX},${newY}].\n${nextNode.desc}\nExits: ${nextNode.exits.join(', ').toUpperCase()}`, 
            type: 'info' 
        });
        
        // Win condition (Reach 2,1)
        if (newX === 2 && newY === 1) {
             socket.emit('message', { text: `TARGET REACHED. Uploading payload...`, type: 'success' });
             // Complete mission
             setTimeout(async () => {
                 p.balance += 1200; // Reward
                 p.missionProgress = {}; // Reset
                 await p.save();
                 socket.emit('player_data', p);
                 socket.emit('message', { text: `MISSION COMPLETE. +1200 ODZ transferred.`, type: 'special' });
                 socket.emit('play_sound', 'success');
             }, 2000);
        }
        
    } else {
        socket.emit('message', { text: 'Cannot go that way. Firewall blocking path.', type: 'warning' });
    }
}

async function handleDownload(user, socket, Player) {
    // Logic for heist completion
    let p = await Player.findOne({ username: user });
    if (!p.missionProgress || !p.missionProgress.active) return;
    
    socket.emit('message', { text: 'Downloading sensitive data...', type: 'loading' });
    
    setTimeout(async () => {
        const reward = 500; // Simplified
        p.balance += reward;
        p.missionProgress = {};
        await p.save();
        socket.emit('player_data', p);
        socket.emit('message', { text: `DOWNLOAD COMPLETE. Sold data for ${reward} ODZ. Mission Accomplished.`, type: 'success' });
    }, 3000);
}

async function handleDefenseAction(user, command, socket, Player) {
    socket.emit('message', { text: `Executing ${command.toUpperCase()} protocol... Defense boosted.`, type: 'success' });
}

module.exports = { 
    listJobs, 
    acceptJob, 
    handleMazeStart, 
    handleNavigate, 
    handleServerHackStart, 
    handleDownload,
    handleDefenseAction 
};
