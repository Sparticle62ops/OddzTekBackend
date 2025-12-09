// game/missions.js

const CORP_TARGETS = ['CyberDyne', 'Massive_Dynamic', 'E_Corp', 'Aperture'];
const WANTED_NAMES = ['Ghost', 'Phantom', 'Zero_Cool', 'Neo'];

function generateJob(level) {
    const types = ['Heist', 'Hunt', 'Defense'];
    const type = types[Math.floor(Math.random() * types.length)];
    const diff = Math.min(5, Math.floor(Math.random() * 2) + level);
    
    let job = {
        id: Math.random().toString(36).substr(2, 5),
        type: type,
        difficulty: diff,
        reward: diff * 500 + 250
    };

    if (type === 'Heist') {
        job.name = `Data Heist: ${CORP_TARGETS[Math.floor(Math.random()*CORP_TARGETS.length)]}`;
        job.desc = "Breach their firewall and download the payload.";
        job.cmd = "server_hack"; // Uses existing logic
    } 
    else if (type === 'Hunt') {
        const target = WANTED_NAMES[Math.floor(Math.random()*WANTED_NAMES.length)];
        job.name = `Bounty Hunt: ${target}`;
        job.desc = `Locate and hack user '${target}'. They are hiding in the network.`;
        job.targetName = target;
        // We'll need a way to spawn a temp NPC for this
    }
    else if (type === 'Defense') {
        job.name = "System Defense Contract";
        job.desc = "Protect our server from incoming attacks for 60 seconds.";
        job.duration = 60;
    }
    
    return job;
}

// In-Memory Store for Offers
const MISSION_OFFERS = {}; // { user: [job1, job2, job3] }

function listJobs(user, socket, Player) {
    // Generate new batch
    // In a real game, maybe regenerate only every 10 mins? For now, fresh every time.
    const pLevel = 1; // get from Player later if needed, assume 1 for generation simplicity here or pass p
    const jobs = [generateJob(1), generateJob(1), generateJob(2)];
    
    MISSION_OFFERS[user] = jobs;

    let msg = "\n=== THE CONTRACT BROKER ===\n";
    jobs.forEach((j, i) => {
        msg += `[ID: ${i+1}] ${j.type.toUpperCase()} | Risk: ${j.difficulty} | Pay: ${j.reward} ODZ\n   "${j.name}"\n   ${j.desc}\n`;
    });
    msg += "Type 'accept [id]' to start.";
    
    socket.emit('message', { text: msg, type: 'info' });
}

async function acceptJob(user, args, socket, Player) {
    const idx = parseInt(args[0]) - 1;
    const offers = MISSION_OFFERS[user];
    
    if (!offers || !offers[idx]) return socket.emit('message', { text: 'Invalid Job ID.', type: 'error' });
    
    const job = offers[idx];
    let p = await Player.findOne({ username: user });
    
    // Set Active Mission
    p.missionProgress = {
        active: job.type.toLowerCase(),
        stage: 1,
        target: job.targetName || null,
        reward: job.reward,
        difficulty: job.difficulty
    };
    
    await p.save();
    socket.emit('player_data', p);
    
    socket.emit('message', { text: `CONTRACT ACCEPTED: ${job.name}`, type: 'special' });
    socket.emit('play_sound', 'login');
    
    // Initial Trigger
    if (job.type === 'Defense') {
        socket.emit('message', { text: "INCOMING PACKETS DETECTED! Type 'block' to defend!", type: 'warning' });
        // Defense logic handles in commands.js
    } else if (job.type === 'Heist') {
        socket.emit('message', { text: "Uplink established. Type 'nav forward' to begin.", type: 'info' });
    }
}

module.exports = { listJobs, acceptJob };