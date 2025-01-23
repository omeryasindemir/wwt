const express = require('express');

const User = require('../models/user');
const Auction = require('../models/auction');
const { authenticate } = require('../middleware/authenticate');
const { csrfCheck } = require('../middleware/csrfCheck');
const { adminCheck } = require('../middleware/adminCheck');
const TCKNCheck = require('../utils/TCKNCheck');
const { updateAuthCredentials, createAuctionWorker, deleteAuctionWorker } = require('../utils/workers');

const router = express.Router();

router.get('/createKey', authenticate, csrfCheck, adminCheck, async (req, res) => {
    try {
        const user = new User({});
        const persistedUser = await user.save();

        res.json({
            key: persistedUser._id,
        });
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.get('/getKey/:keyid', authenticate, csrfCheck, adminCheck, async (req, res) => {
    try {
        const keyid = req.params.keyid;

        if (keyid === 'all') {
            const users = await User.find({});
            var usersObject = [];
            for (const user of users) {
                usersObject.push(user.toObject());
            }
            return res.json(usersObject);
        } else {
            const user = await User.findOne({ _id: keyid });
            return res.json(user.toObject());
        }
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.post('/manageKey', authenticate, csrfCheck, adminCheck, async (req, res) => {
    try {
        const { key, tckn, password, credit } = req.body;
        if (typeof key !== 'string') {
            return res.status(400).json({
                error: 'Key geçersiz',
            });
        }

        const user = await User.findOne({ _id: key });
        if (!user) {
            throw new Error("invalid_key");
        }

        var updates = 0;

        if (tckn !== user.tckn) {
            if (!TCKNCheck(tckn)) {
                throw new Error('TC Kimlik Numarası Geçersiz');
            }
            user.tckn = tckn;
            updates++;
        }

        if (password !== user.password) {
            if (typeof password !== 'string') {
                throw new Error('Şifre Geçersiz');
            }
            user.password = password;
            updates++;
        }

        if (credit !== user.credit) {
            if (credit < 0) {
                throw new Error("Kredi 0'dan küçük olamaz");
            }
            user.credit = credit;
            updates++;
        }

        if (updates > 0) {
            await user.save();
            await updateAuthCredentials(user._id, user.tckn, user.password);
        }

        res.json({
            title: 'Bilgiler güncellendi',
            detail: 'Bilgiler başarıyla güncellendi'
        });
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.get('/getAuction/:auctionid', authenticate, csrfCheck, adminCheck, async (req, res) => {
    try {
        const auctionid = req.params.auctionid;

        if (auctionid === 'all') {
            const auctions = await Auction.find({});
            var auctionsObject = [];
            for (const auction of auctions) {
                let obj = auction.toObject();
                delete obj.logs;
                auctionsObject.push(obj);
            }
            return res.json(auctionsObject);
        } else {
            const auction = await Auction.findOne({ _id: auctionid });
            return res.json(auction.toObject());
        }
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.post('/manageAuction/:auctionid', authenticate, csrfCheck, adminCheck, async (req, res) => {
    try {
        const auctionid = req.params.auctionid;
        let { url, maxBid, isStopped } = req.body;
        const auction = await Auction.findOne({ _id: auctionid, userId: req.session.userId });
        if (!auction) {
            return res.status(400).json({
                error: 'İhale geçersiz'
            });
        }

        var updates = 0;

        const auctionUrl = url.trim();
        if (auction.url !== auctionUrl) {
            if (auctionUrl !== '') {
                return res.status(400).json({
                    error: 'İhale linki geçersiz'
                });
            }
            auction.url = auctionUrl;
            updates++;
        }

        if (auction.maxBid !== maxBid) {
            if (maxBid <= 0) {
                return res.status(400).json({
                    error: 'Maksimum tutar geçersiz'
                });
            }
            auction.maxBid = maxBid;
            updates++;
        }

        if (auction.isStopped && isStopped === false) {
            auction.isStopped = false;
            await createAuctionWorker(auction._id);
            updates++;
        } else if (!auction.isStopped && isStopped === true) {
            auction.isStopped = true;
            await deleteAuctionWorker(auction.userId, auction._id, 'Yönetici durdurma talep etti.');
            updates++;
        }
        
        if (updates > 0) {
            await auction.save();
            await updateAuctionDetails(req.session.userId, auction._id, maxBid);
        }

        res.json({});
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

module.exports = router;