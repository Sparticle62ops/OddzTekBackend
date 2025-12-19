async function handleFiles(user, command, args, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    // LIST FILES
    if (command === 'ls' || command === 'files') {
        if (p.files.length === 0) {
            return socket.emit('message', { text: '/root/ is empty.', type: 'info' });
        }
        
        const fileList = p.files.map(f => {
            // Fake file metadata for immersion
            const size = Math.floor(Math.random() * 500) + 10; 
            const perm = '-rw-r--r--';
            return `${perm}  user  ${size}B  ${f}`;
        }).join('\n');
        
        socket.emit('message', { 
            text: `\nDirectory listing of /root/:\n${fileList}\n\nTotal: ${p.files.length} files.`, 
            type: 'info' 
        });
    }
    
    // READ FILES
    else if (command === 'cat' || command === 'read') {
        const filename = args[0];
        if (!filename) return socket.emit('message', { text: 'Usage: cat [filename]', type: 'error' });
        
        if (p.files.includes(filename)) {
            // Check if it's a known file type with specific content
            let content = "[BINARY DATA ENCRYPTED]";
            
            if (filename.endsWith('.txt') || filename === 'readme.txt') {
                content = "Welcome to OddzTek OS v16.0.\nUse 'help' to see available commands.\nStay safe, stay hidden.";
            } else if (filename.includes('wallet')) {
                content = "0x7F... [ENCRYPTED KEY] ... (Use 'unlock' to decrypt)";
            } else if (filename.includes('log')) {
                content = "SYSTEM LOG:\n[WARN] Unauthorized access attempt blocked.\n[INFO] Daemon started.";
            } else {
                 content = `[OPENING ${filename}]...\n\n(File content would appear here)`;
            }

            socket.emit('message', { 
                text: `\n> ${filename}\n----------------\n${content}\n----------------\n[EOF]`, 
                type: 'system' 
            });
        } else {
            socket.emit('message', { text: `Error: File '${filename}' not found.`, type: 'error' });
        }
    }
}

async function handleInventory(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    
    if (p.inventory.length === 0) {
        return socket.emit('message', { text: 'Inventory Storage: EMPTY', type: 'info' });
    }
    
    // Group items?
    const counts = {};
    p.inventory.forEach(i => { counts[i] = (counts[i] || 0) + 1; });
    
    let msg = "\n=== HARDWARE & STORAGE ===\n";
    for (const [item, count] of Object.entries(counts)) {
        msg += `> ${item.toUpperCase()} (x${count})\n`;
    }
    
    socket.emit('message', { text: msg, type: 'info' });
}

module.exports = { handleFiles, handleInventory };
