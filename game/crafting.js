const { SHOP_ITEMS } = require('./constants');

const RECIPES = [
    { result: 'brute_force_v2', ingredient: 'brute_force', count: 2 },
    { result: 'sql_map_v2', ingredient: 'sql_map', count: 2 }
];

async function handleCraft(user, args, socket, Player) {
    const action = args[0] ? args[0].toLowerCase() : 'list';
    
    if (action === 'list') {
        let msg = "\n=== COMPILER (CRAFTING) ===\n";
        msg += "Combine duplicate software to compile advanced versions.\n\n";
        for (const r of RECIPES) {
            msg += `Recipe: ${r.count}x [${r.ingredient}] -> [${r.result}]\n`;
        }
        msg += "\nUsage: combine [ingredient_name]\n";
        return socket.emit('message', { text: msg, type: 'info' });
    }

    const recipe = RECIPES.find(r => r.ingredient === action);

    if (!recipe) {
        return socket.emit('message', { text: "No valid recipe found for this item.", type: 'error' });
    }

    let p = await Player.findOne({ username: user });
    
    // Count items in inventory
    const count = p.inventory.filter(i => i === recipe.ingredient).length;
    
    if (count < recipe.count) {
        return socket.emit('message', { text: `Insufficient code blocks. Need ${recipe.count}x ${recipe.ingredient}.`, type: 'error' });
    }

    // Remove ingredients
    let removed = 0;
    p.inventory = p.inventory.filter(item => {
        if (item === recipe.ingredient && removed < recipe.count) {
            removed++;
            return false;
        }
        return true;
    });

    // Add result
    p.inventory.push(recipe.result);
    
    await p.save();
    socket.emit('player_data', p);
    socket.emit('message', { text: `COMPILATION SUCCESS: Created ${recipe.result}`, type: 'success' });
    socket.emit('play_sound', 'success');
}

module.exports = { handleCraft };
