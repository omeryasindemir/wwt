const express = require('express');

const User = require('../models/user');
const Auction = require('../models/auction');
const { authenticate } = require('../middleware/authenticate');
const { csrfCheck } = require('../middleware/csrfCheck');
const { createAuctionWorker, updateAuctionDetails } = require('../utils/workers');

const router = express.Router();

router.post('/new', authenticate, csrfCheck, async (req, res) => {
    try {
        const { name, url, maxBid } = req.body;
        const auctionUrl = url.trim();

        const isValidUrl = (string) => {
            try {
                new URL(string); 
                return true;
            } catch {
                return false;
            }
        };

        if (!isValidUrl(auctionUrl)) {
            return res.status(400).json({
                error: 'İhale linki geçersiz'
            });
        }


        if (maxBid <= 0) {
            return res.status(400).json({
                error: 'Maksimum tutar geçersiz'
            });
        }

        if (typeof name !== 'string') {
            return res.status(400).json({
                error: 'İsim geçersiz'
            });
        }

        const user = await User.findOne({ _id: req.session.userId });
        if (user.credit < 1) {
            throw new Error('Kredi yetersiz');
        }

        const auction = new Auction({ userId: req.session.userId, name, url: auctionUrl, maxBid });
        const persistedAuction = await auction.save();

        user.credit -= 1;
        await user.save();

        await createAuctionWorker(persistedAuction._id);

        res.json({
            id: persistedAuction._id,
        });
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.get('/get/:auctionid', authenticate, csrfCheck, async (req, res) => {
    try {
        const auctionid = req.params.auctionid;

        if (auctionid === 'all') {
            const auctions = await Auction.find({ userId: req.session.userId });
            var auctionsObject = [];
            for (const auction of auctions) {
                let obj = auction.toObject();
                delete obj.logs;
                auctionsObject.push(obj);
            }
            return res.json(auctionsObject);
        } else {
            const auction = await Auction.findOne({ _id: auctionid, userId: req.session.userId });
            return res.json(auction.toObject());
        }
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.post('/manage/:auctionid', authenticate, csrfCheck, async (req, res) => {
    try {
        const auctionid = req.params.auctionid;
        const {name, maxBid } = req.body;
        const auction = await Auction.findOne({ _id: auctionid, userId: req.session.userId });
        if (!auction) {
            return res.status(400).json({
                error: 'İhale geçersiz'
            });
        }

        var updates = 0;

        if (auction.name !== name) {
            if (typeof name !== 'string') {
                return res.status(400).json({
                    error: 'İsim geçersiz'
                });
            }

            auction.name = name;
            updates++;
        }

        if (auction.maxBid !== maxBid) {
            if (maxBid <= 0) {
                return res.status(400).json({
                    error: 'Maksimum tutar geçersiz'
                });
            }
            auction.maxBid = maxBid;

            if (auction.isStopped) {
                await createAuctionWorker(auction._id);
                auction.isStopped = false;
            } else {
                await updateAuctionDetails(req.session.userId, auction._id, maxBid);
            }

            updates++;
        }

        if (updates > 0) {
            await auction.save();
        }

        res.json({});
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

module.exports = router;