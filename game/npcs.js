const NPC_FACTIONS = {
    'CORPO': { name: 'OmniCorp', prefix: 'corp', risk: 'high', reward: 'high' },
    'GANG': { name: 'NeonDragons', prefix: 'gang', risk: 'low', reward: 'medium' },
    'GOV': { name: 'GovSec', prefix: 'gov', risk: 'extreme', reward: 'legendary' }
};

const NPC_NAMES = [
    'The_Architect', 'ZeroCool', 'AcidBurn', 'Morpheus', 'Trinity', 
    'Mr_Robot', 'WhiteRose', 'DedSec_Prime', 'LaughingMan'
];

// Simulate NPC Activity
// In a real DB, these would be documents. For now, we generate them dynamically or store in memory.
let ACTIVE_NPCS = [];

function initNPCs() {
    ACTIVE_NPCS = [];
    for(let i=0; i<5; i++) {
        generateNPC();
    }
}

function generateNPC() {
    const name = NPC_NAMES[Math.floor(Math.random() * NPC_NAMES.length)] + '_' + Math.floor(Math.random()*99);
    const factionKey = Object.keys(NPC_FACTIONS)[Math.floor(Math.random() * 3)];
    const faction = NPC_FACTIONS[factionKey];
    
    const npc = {
        username: name,
        faction: faction.name,
        level: Math.floor(Math.random() * 10) + 1,
        balance: Math.floor(Math.random() * 5000) + 500,
        security: {
            firewall: Math.floor(Math.random() * 5) + 1,
            traceSpeed: Math.floor(Math.random() * 3) + 1
        },
        files: ['sys_config.ini', 'account_data.db']
    };
    
    if (factionKey === 'CORPO') npc.files.push('trade_secrets.docx');
    if (factionKey === 'GOV') npc.files.push('classified_intel.pdf');
    
    ACTIVE_NPCS.push(npc);
    return npc;
}

function getNPCs() {
    if (ACTIVE_NPCS.length < 5) generateNPC();
    return ACTIVE_NPCS;
}

function findNPC(name) {
    return ACTIVE_NPCS.find(n => n.username === name);
}

module.exports = { initNPCs, getNPCs, findNPC };
