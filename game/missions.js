// game/missions.js

const TARGETS = ['CyberDyne', 'Global_Dynamics', 'Massive_Dynamic', 'Umbrella_Corp', 'Aperture_Science'];
const DATA_TYPES = ['Financial_Records', 'Prototype_Blueprints', 'Employee_Database', 'Blackmail_Material'];
const WANTED_NAMES = ['Ghost', 'Phantom', 'Zero_Cool', 'Neo', 'Morpheus'];

// In-Memory Store for Offers: { user: [job1, job2, job3] }
const MISSION_OFFERS = {}; 

function generateJob(level) {
    const types = ['Heist', 'Hunt', 'Defense'];
    const roll = Math.random();
    let type = 'Heist';
    if (roll > 0.5) type = 'Defense';
    if (roll > 0.8) type = 'Hunt';

    const baseDiff = Math.ceil(level / 2); 
    const diff = Math.min(5, Math.max(1, baseDiff + Math.floor(Math.random() * 3) - 1));
    const reward = diff * 400 + Math.floor(Math.random() * 300);
    
    let job = {
        id: Math.random().toString(36).substr(2, 5),
        type: type,
        difficulty: diff,
        reward: reward
    };

    if (type === 'Heist') {
        const target = TARGETS[Math.floor(Math.random() * TARGETS.length)];
        job.name = `Data Heist: ${target}`;
        job.desc = `Infiltrate ${target} and extract ${DATA_TYPES[Math.floor(Math.random() * DATA_TYPES.length)]}.`;
        job.targetName = target;
    } 
    else if (type === 'Hunt') {
        const target = WANTED_NAMES[Math.floor(Math.random()*WANTED_NAMES.length)];
        job.name = `Bounty Hunt: ${target}`;
        job.desc = `Locate and hack user '${target}'.`;
        job.targetName = target;
    }
    else if (type === 'Defense') {
        job.name = "System Defense Contract";
        job.desc = "Protect our server from incoming attacks. Use 'block' or 'patch'.";
        job.targetName = "Client_Server";
    }
    
    return job;
}

// --- COMMANDS ---

async function listJobs(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    if (!p) return;

    const jobs = [generateJob(p.level), generateJob(p.level), generateJob(p.level)];
    MISSION_OFFERS[user] = jobs;

    let msg = "\n=== THE CONTRACT BROKER ===\n";
    jobs.forEach((j, i) => {
        msg += `[ID: ${i+1}] ${j.type.toUpperCase()} | Risk: ${j.difficulty}/5 | Pay: ${j.reward} ODZ\n   "${j.name}"\n   ${j.desc}\n`;
    });
    msg += "\nType 'accept [id]' to sign contract.";
    
    socket.emit('message', { text: msg, type: 'info' });
}

async function acceptJob(user, args, socket, Player) {
    const idx = parseInt(args[0]) - 1;
    const offers = MISSION_OFFERS[user];
    
    if (!offers || !offers[idx]) return socket.emit('message', { text: 'Invalid Job ID. Run "jobs" first.', type: 'error' });
    
    const job = offers[idx];
    
    // Construct Mission Object
    const newMission = {
        active: job.type.toLowerCase(),
        stage: 1, 
        jobId: job.id,
        targetName: job.targetName,
        difficulty: job.difficulty,
        reward: job.reward
    };
    
    // ATOMIC WRITE FIX: Forces DB update immediately
    const p = await Player.findOneAndUpdate(
        { username: user },
        { $set: { missionProgress: newMission } },
        { new: true }
    );

    socket.emit('player_data', p);
    
    socket.emit('message', { text: `CONTRACT ACCEPTED: ${job.name}`, type: 'special' });
    socket.emit('play_sound', 'login');
    
    if (job.type === 'Defense') {
        socket.emit('message', { text: "INCOMING PACKETS DETECTED! Type 'block' or 'patch' to defend!", type: 'warning' });
    } else if (job.type === 'Heist') {
        socket.emit('message', { text: "Uplink established. Type 'server_hack' to begin.", type: 'info' });
    } else if (job.type === 'Hunt') {
        socket.emit('message', { text: `Target '${job.targetName}' is active. Type 'scan ${job.targetName}' to track.`, type: 'info' });
    }
}

// --- MISSION LOGIC HANDLERS ---

async function handleServerHackStart(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    if (!p.missionProgress || p.missionProgress.active !== 'heist') {
        return socket.emit('message', { text: 'No active Heist contract. Type "jobs" to find work.', type: 'error' });
    }

    if (p.missionProgress.stage > 1) {
        return socket.emit('message', { text: 'Uplink already established. Check status.', type: 'warning' });
    }

    // Hardware Check
    const reqCpu = Math.ceil(p.missionProgress.difficulty / 2);
    if (p.hardware.cpu < reqCpu) {
         return socket.emit('message', { text: `Hardware Insufficient. Need CPU v${reqCpu}.`, type: 'error' });
    }

    socket.emit('message', { 
        text: `[MISSION STARTED]\nTarget: ${p.missionProgress.targetName}\nSecurity Level: ${p.missionProgress.difficulty}\n> Uplink Established.\n> ICE Detected: Firewall Layer.\nType 'nav forward' to approach.`, 
        type: 'special' 
    });
    socket.emit('play_sound', 'hack');
}

async function handleNavigate(user, args, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    if (!p.missionProgress || p.missionProgress.active !== 'heist') return;

    const dir = args[0] ? args[0].toLowerCase() : '';
    const stage = p.missionProgress.stage;

    // Stage 1 -> 2 (Approach Firewall)
    if (stage === 1) {
        if (['n','north','forward'].includes(dir)) {
            p.missionProgress.stage = 2;
            p.markModified('missionProgress');
            await p.save();
            socket.emit('message', { text: `[FIREWALL ENCOUNTER]\nEncryption detected.\nType 'decrypt' to break.`, type: 'warning' });
        } else {
            socket.emit('message', { text: "Connection path restricted. Move 'forward' only.", type: 'error' });
        }
    }
    // Stage 3 -> 4 (Approach Core)
    else if (stage === 3) {
         if (['n','north','forward'].includes(dir)) {
             p.missionProgress.stage = 4;
             p.markModified('missionProgress');
             await p.save();
             socket.emit('message', { text: `[CORE REACHED]\nData payload found.\nType 'download' to extract.`, type: 'success' });
         }
    }
}

async function handleDownload(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    if (p.missionProgress && p.missionProgress.active === 'heist' && p.missionProgress.stage === 4) {
        const reward = p.missionProgress.reward;
        
        // Use atomic update
        p = await Player.findOneAndUpdate(
            { username: user },
            { 
                $inc: { balance: reward, xp: p.missionProgress.difficulty * 50 },
                $set: { missionProgress: {} }
            },
            { new: true }
        );

        socket.emit('message', { text: `DATA SECURED.\nContract Complete.\nPayment Transferred: +${reward} ODZ`, type: 'success' });
        socket.emit('player_data', p);
        socket.emit('play_sound', 'success');
        return;
    }
    socket.emit('message', { text: 'No downloadable assets found.', type: 'error' });
}

async function handleDefenseAction(user, action, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    if (!p.missionProgress || p.missionProgress.active !== 'defense') {
        return socket.emit('message', { text: 'No active Defense contract.', type: 'error' });
    }
    
    const diff = p.missionProgress.difficulty;
    const defenseScore = p.hardware.networkLevel + (Math.random() * 3); 
    
    socket.emit('message', { text: `Running ${action} protocol...`, type: 'loading' });

    if (defenseScore >= diff) {
        // Success
        p.missionProgress.stage = (p.missionProgress.stage || 0) + 1;
        socket.emit('message', { text: `[SUCCESS] Attack vector mitigated. (${p.missionProgress.stage}/3 waves repelled)`, type: 'success' });
        
        if (p.missionProgress.stage >= 3) {
             const reward = p.missionProgress.reward;
             
             // Atomic Finish
             p = await Player.findOneAndUpdate(
                { username: user },
                { 
                    $inc: { balance: reward, xp: diff * 40 },
                    $set: { missionProgress: {} }
                },
                { new: true }
             );
             
             socket.emit('message', { text: `CONTRACT COMPLETE. System Integrity 100%.\nPayment: +${reward} ODZ`, type: 'special' });
             socket.emit('play_sound', 'success');
             socket.emit('player_data', p);
             return;
        } else {
             socket.emit('message', { text: `WARNING: Next wave incoming... Type 'block' or 'patch'.`, type: 'warning' });
        }
    } else {
        socket.emit('message', { text: `[FAILURE] Firewall breached! Connection unstable. Try again!`, type: 'error' });
        socket.emit('play_sound', 'error');
    }
    
    p.markModified('missionProgress');
    await p.save();
}

module.exports = { listJobs, acceptJob, handleServerHackStart, handleNavigate, handleDownload, handleDefenseAction, generateMaze: null };
