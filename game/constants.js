module.exports = {
    LEVEL_XP_REQ: 200,
    MINE_DURATION: 20000,
    MINE_TICK: 5000,
    BASE_MINE_COOLDOWN: 20000,
    HACK_COOLDOWN: 60000,
    SHOP_ITEMS: {
        'cpu_v2': { price: 500, type: 'upgrade', stat: 'cpuLevel', val: 2, desc: 'Doubles mining yield.' },
        'cpu_v3': { price: 2000, type: 'upgrade', stat: 'cpuLevel', val: 3, desc: 'Triples mining yield.' },
        'network_v2': { price: 750, type: 'upgrade', stat: 'networkLevel', val: 2, desc: 'Reduces cooldowns.' },
        'firewall_v2': { price: 600, type: 'upgrade', stat: 'securityLevel', val: 2, desc: 'Harder PINs (4 digits).' },
        'firewall_v3': { price: 1500, type: 'upgrade', stat: 'securityLevel', val: 3, desc: 'Max Security (5 digits).' },
        'honeypot': { price: 300, type: 'consumable', desc: 'Trap next hacker.' },
        'decryptor_v1': { price: 800, type: 'tool', desc: 'Passive: Reveals 1 digit at hack start.' },
        'brute_force_v1': { price: 1500, type: 'tool', desc: 'Active: Insta-guess 1 digit.' },
        'cloak_v1': { price: 1200, type: 'tool', desc: 'Passive: Hide from Leaderboard.' },
        'theme_amber': { price: 100, type: 'skin', val: 'amber', desc: 'Retro style.' },
        'theme_plasma': { price: 250, type: 'skin', val: 'plasma', desc: 'Neon style.' },
        'theme_matrix': { price: 500, type: 'skin', val: 'matrix', desc: 'Hacker style.' }
    }
};