const mongoose = require('mongoose');

const AuctionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    url: String,
    maxBid: Number,
    lastBid: Number,
    userOffer: Number,
    endTime: Date,
    logs: [String],
    isStopped: {
        type: Boolean,
        default: false
    },
    isDone: {
        type: Boolean,
        default: false
    },
    isWon: {
        type: Boolean,
        default: null
    }
});

module.exports = mongoose.model('Auction', AuctionSchema);