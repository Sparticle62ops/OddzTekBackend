// game/npcs.js

const MISSIONS = [
    { id: 1, target: 'Corp_Payroll', difficulty: 2, reward: 500 },
    { id: 2, target: 'Gov_Archive', difficulty: 4, reward: 1200 },
    { id: 3, target: 'Unknown_Signal', difficulty: 5, reward: 2500 }
];

function listJobs(socket) {
    let msg = "\n=== THE BROKER'S LIST ===\n";
    MISSIONS.forEach(m => {
        msg += `[ID: ${m.id}] Target: ${m.target} | Diff: ${m.difficulty} | Reward: ${m.reward} ODZ\n`;
    });
    msg += "Type 'accept [id]' to start contract.";
    socket.emit('message', { text: msg, type: 'info' });
}

async function acceptJob(user, args, socket, Player) {
    // Logic to set player's current mission target to the NPC
    // Then 'hack' command works on NPC names
}

module.exports = { listJobs, acceptJob };