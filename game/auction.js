async function handleAuction(user, args, socket, Player, Auction) {
    const action = args[0] ? args[0].toLowerCase() : 'list';
    let p = await Player.findOne({ username: user });

    if (action === 'list') {
        const items = await Auction.find().sort({ price: 1 }).limit(10);
        if (items.length === 0) return socket.emit('message', { text: "Auction House Empty.", type: 'info' });

        let msg = "\n=== BLACK MARKET AUCTIONS ===\n";
        items.forEach((item, i) => {
            msg += `ID: ${item._id.toString().slice(-4)} | Item: ${item.name} | Price: ${item.price} ODZ | Seller: ${item.seller}\n`;
        });
        msg += "\nUsage: auction buy [id_suffix] | auction sell [item] [price]";
        socket.emit('message', { text: msg, type: 'info' });
        return;
    }

    if (action === 'sell') {
        const item = args[1];
        const price = parseInt(args[2]);

        if (!item || !price) return socket.emit('message', { text: "Usage: auction sell [item_name] [price]", type: 'error' });
        if (!p.inventory.includes(item)) return socket.emit('message', { text: "You don't own this item.", type: 'error' });
        if (price < 0) return socket.emit('message', { text: "Invalid price.", type: 'error' });

        // Remove item
        const idx = p.inventory.indexOf(item);
        if (idx > -1) p.inventory.splice(idx, 1);
        await p.save();

        // List item
        const auction = new Auction({
            seller: user,
            name: item,
            price: price,
            created: Date.now()
        });
        await auction.save();

        socket.emit('player_data', p);
        socket.emit('message', { text: `Listed ${item} for ${price} ODZ.`, type: 'success' });
        return;
    }

    if (action === 'buy') {
        const idSuffix = args[1];
        if (!idSuffix) return socket.emit('message', { text: "Usage: auction buy [id_suffix]", type: 'error' });

        // Find by suffix (not efficient but works for small scale)
        const all = await Auction.find();
        const item = all.find(a => a._id.toString().slice(-4) === idSuffix);

        if (!item) return socket.emit('message', { text: "Item not found.", type: 'error' });
        if (item.seller === user) return socket.emit('message', { text: "You cannot buy your own item.", type: 'error' });
        if (p.balance < item.price) return socket.emit('message', { text: "Insufficient funds.", type: 'error' });

        // Process transaction
        p.balance -= item.price;
        p.inventory.push(item.name);
        await p.save();

        // Pay seller
        const seller = await Player.findOne({ username: item.seller });
        if (seller) {
            seller.balance += item.price;
            await seller.save();
        }

        await Auction.deleteOne({ _id: item._id });

        socket.emit('player_data', p);
        socket.emit('message', { text: `Purchased ${item.name} for ${item.price} ODZ.`, type: 'success' });
        return;
    }
}

module.exports = { handleAuction };
