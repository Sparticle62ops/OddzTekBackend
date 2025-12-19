async function handleChat(user, args, socket, io) {
    const msg = args.join(' ');
    if (msg) {
        // Timestamp for realism?
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        io.emit('message', { text: `[${time}] <${user}> ${msg}`, type: 'info' });
    } else {
        socket.emit('message', { text: 'Usage: chat [message]', type: 'error' });
    }
}

async function handleInvite(user, socket, Player) {
    let p = await Player.findOne({ username: user });
    socket.emit('message', { 
        text: `\n=== RECRUITMENT PROTOCOL ===\nUPLINK CODE: ${p.inviteCode}\nShare this code to recruit new operatives.`, 
        type: 'special' 
    });
}

async function handleMail(user, args, socket, Player) {
    const action = args[0] ? args[0].toLowerCase() : 'check';
    let p = await Player.findOne({ username: user });

    if (action === 'check' || action === 'list') {
        if (!p.inbox.length) {
            return socket.emit('message', { text: '>> INBOX EMPTY. No new secure packets.', type: 'info' });
        }
        
        let msg = "\n=== SECURE INBOX ===\n";
        p.inbox.forEach((m, i) => {
            const status = m.read ? '[READ]' : '[NEW!]';
            msg += `${i+1}. ${status} FROM: ${m.from} | DATE: ${new Date(m.date).toLocaleDateString()}\n`;
        });
        msg += "\nType 'mail read [id]' to decrypt message.";
        socket.emit('message', { text: msg, type: 'info' });
    } 
    else if (action === 'read') {
        const id = parseInt(args[1]);
        if (isNaN(id) || id < 1 || id > p.inbox.length) {
            return socket.emit('message', { text: 'Error: Message ID not found.', type: 'error' });
        }
        
        const msgIndex = id - 1;
        const msg = p.inbox[msgIndex];
        
        // Mark as read
        p.inbox[msgIndex].read = true;
        // In Mongoose, modifying array elements might need markModified if it's mixed, but here it's defined schema.
        // However, standard saving should work.
        await p.save();
        
        socket.emit('message', { 
            text: `\n--- DECRYPTED MESSAGE [ID: ${id}] ---\nFROM: ${msg.from}\nSENT: ${new Date(msg.date).toLocaleString()}\n\n"${msg.msg}"\n-----------------------------------`, 
            type: 'system' 
        });
    }
    else if (action === 'send') {
        const targetUser = args[1];
        const content = args.slice(2).join(' '); 
        
        if (!targetUser || !content) {
            return socket.emit('message', { text: 'Usage: mail send [username] [message]', type: 'error' });
        }
        
        const t = await Player.findOne({ username: targetUser });
        if (!t) {
            return socket.emit('message', { text: `Error: User '${targetUser}' not found in database.`, type: 'error' });
        }
        
        t.inbox.push({ 
            from: user, 
            msg: content, 
            read: false,
            date: Date.now()
        });
        await t.save();
        
        socket.emit('message', { text: `>> Packet sent to ${targetUser}. Encryption verified.`, type: 'success' });
    }
    else if (action === 'clear') {
         p.inbox = [];
         await p.save();
         socket.emit('message', { text: 'Inbox purged.', type: 'success' });
    }
    else {
        socket.emit('message', { text: 'Usage: mail [check/read/send/clear]', type: 'error' });
    }
}

module.exports = { handleChat, handleInvite, handleMail };
