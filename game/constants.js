module.exports = {
    // SYSTEM CONSTANTS
    LEVEL_XP_REQ: 250,
    MINE_DURATION: 20000,
    MINE_TICK: 5000,
    BASE_MINE_COOLDOWN: 15000,
    HACK_COOLDOWN: 45000,

    // HACKING PORTS & VULNERABILITIES
    PORTS: {
        21: { service: 'FTP', type: 'brute', diff: 1 },
        22: { service: 'SSH', type: 'overflow', diff: 3 },
        80: { service: 'HTTP', type: 'sql', diff: 2 },
        443: { service: 'HTTPS', type: 'ssl_exploit', diff: 4 },
        3306: { service: 'MySQL', type: 'db_inject', diff: 3 },
        8080: { service: 'Proxy', type: 'bypass', diff: 2 }
    },

    // SHOP CATALOG
    SHOP_ITEMS: {
        // --- HARDWARE ---
        'cpu_v2': { price: 500, type: 'hardware', slot: 'cpu', val: 2, rarity: 'uncommon', desc: 'Dual-Core. 2x Mining Speed.' },
        'cpu_v3': { price: 2500, type: 'hardware', slot: 'cpu', val: 4, rarity: 'rare', desc: 'Quantum Core. 4x Mining Speed.' },
        
        'gpu_v1': { price: 1000, type: 'hardware', slot: 'gpu', val: 1, rarity: 'common', desc: 'Basic GPU. Enables Hash Cracking.' },
        'gpu_v2': { price: 3500, type: 'hardware', slot: 'gpu', val: 2, rarity: 'rare', desc: 'Crypto Miner GPU. +20% Hack Success.' },
        
        'ram_v2': { price: 800, type: 'hardware', slot: 'ram', val: 16, rarity: 'uncommon', desc: '16GB RAM. Run complex exploits.' },
        
        'server_rack': { price: 50000, type: 'infrastructure', rarity: 'legendary', desc: 'Passive Income Generator (100 ODZ/m).' },

        // --- SOFTWARE / TOOLS ---
        'brute_force': { price: 300, type: 'software', func: 'brute', rarity: 'common', desc: 'Cracks FTP/SSH passwords.' },
        'brute_force_v2': { price: 900, type: 'software', func: 'brute', rarity: 'rare', desc: 'Faster Cracking (High Success).' },
        'sql_map': { price: 600, type: 'software', func: 'sql', rarity: 'uncommon', desc: 'Injects SQL commands (Port 80).' },
        'sql_map_v2': { price: 1500, type: 'software', func: 'sql', rarity: 'rare', desc: 'Advanced Injection (Bypasses Firewall).' },
        'zero_day': { price: 10000, type: 'consumable', rarity: 'legendary', desc: 'Guaranteed Root Access (1 use).' },
        
        // --- SECURITY ---
        'firewall_v2': { price: 600, type: 'security', val: 2, rarity: 'uncommon', desc: 'Closes Port 21.' },
        'firewall_v3': { price: 2000, type: 'security', val: 3, rarity: 'rare', desc: 'Active Monitoring.' },
        'honeypot': { price: 500, type: 'consumable', rarity: 'rare', desc: 'Trap hackers.' },

        // --- COSMETICS ---
        'theme_amber': { price: 100, type: 'skin', val: 'amber', rarity: 'common', desc: 'Classic retro style.' },
        'theme_plasma': { price: 250, type: 'skin', val: 'plasma', rarity: 'uncommon', desc: 'Cyberpunk neon.' },
        'theme_matrix': { price: 500, type: 'skin', val: 'matrix', rarity: 'rare', desc: 'Falling code rain.' },
        'theme_red': { price: 1000, type: 'skin', val: 'red', rarity: 'legendary', desc: 'System Critical Red.' }
    },

    // LOOT TABLE (For File System)
    LOOT: [
        { id: 'data_shard_01', name: 'Encrypted Shard', val: 50, rarity: 'common' },
        { id: 'btc_wallet', name: 'Lost Wallet.dat', val: 500, rarity: 'rare' },
        { id: 'corp_secrets', name: 'Corporate Secrets', val: 2000, rarity: 'legendary' }
    ]
};