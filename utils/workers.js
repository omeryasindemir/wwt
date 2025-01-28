const { Worker } = require('worker_threads');
const User = require('../models/user');
const Auction = require('../models/auction');
const path = require('path');

let Workers = {};

const createAuthWorker = async (userid, tckn, password, cookie) => {
    const authWorker = new Worker(path.join(__dirname, '../UYAPworkers/auth.js'), { workerData: { tckn, password, cookie } });
    authWorker.on('message', async (data) => {
        try {
            switch (data.op) {
                case 0:
                    await User.updateOne({ _id: userid }, { cookie: data.value });
                    for (const auctionWorker in Object.values(Workers[userid].auctionWorkers)) {
                        auctionWorker.postMessage({ op: 0, cookie: data.value });
                    }
                    Workers[userid]['latestCookie'] = data.value;
                    break;
                case 1:
                    await User.updateOne({ _id: userid }, { $push: { logs: `[${new Date().toLocaleString()}][HATA] ${data.value}` } });
                    break;
                case 2:
                    await User.updateOne({ _id: userid }, { $push: { logs: `[${new Date().toLocaleString()}][BILGI] ${data.value}` } });
                    break;
            }
        } catch (error) {
            console.log(error);
        }
    });
    Workers[userid] = { 'authWorker': authWorker, 'latestCookie': cookie, 'auctionWorkers': {} };
};

const createAuctionWorker = async (auctionid) => {
    const auction = await Auction.findOne({ _id: auctionid }).populate('userId');
    const user = auction.userId;
    const doesAuthWorkerExist = Workers.hasOwnProperty(user._id);
    if (doesAuthWorkerExist && Workers[user._id]['auctionWorkers'].hasOwnProperty(auctionid)) {
        return;
    }
    if (!doesAuthWorkerExist) {
        await createAuthWorker(user._id, user.tckn, user.password, user.cookie);
    }
    const auctionWorker = new Worker(path.join(__dirname, '../UYAPworkers/auction.js'), { workerData: { url: auction.url, maxBid: auction.maxBid, cookie: Workers[user._id]['latestCookie'] } });
    auctionWorker.on('message', async (data) => {
        try {
            switch (data.op) {
                case 0:
                    await Auction.updateOne({ _id: auctionid }, { lastBid: data.value.lastOffer, endTime: data.value.endTime });
                    break;
                case 1:
                    await Auction.updateOne({ _id: auctionid }, { $push: { logs: `[${new Date().toLocaleString()}][HATA] ${data.value}` } });
                    break;
                case 2:
                    await Auction.updateOne({ _id: auctionid }, { $push: { logs: `[${new Date().toLocaleString()}][BILGI] ${data.value}` } });
                    break;
                case 3:
                    await Auction.updateOne({ _id: auctionid }, { isStopped: true });
                    await deleteAuctionWorker(user._id, auctionid, data.value);
                    break;
                case 4:
                    await Auction.updateOne({ _id: auctionid }, { isDone: true });
                    await deleteAuctionWorker(user._id, auctionid, data.value);
                    break;
                case 5:
                    Workers[user._id]['authWorker'].postMessage({ op: 0 });
                    break;
            }
        } catch (error) {
            console.log(error);
        }
    });
    Workers[user._id]['auctionWorkers'][auctionid] = auctionWorker;
};

const deleteAuctionWorker = async (userid, auctionid, reason) => {
    try {
        if (Workers.hasOwnProperty(userid) && Workers[userid]['auctionWorkers'].hasOwnProperty(auctionid)) {
            Workers[userid]['auctionWorkers'][auctionid].terminate();
            delete Workers[userid]['auctionWorkers'][auctionid];
            await Auction.updateOne({ _id: auctionid }, { $push: { logs: `[${new Date().toLocaleString()}][CIKIS] ${reason}` } });

            if (Object.keys(Workers[userid]['auctionWorkers']).length === 0) {
                Workers[userid]['authWorker'].terminate();
                delete Workers[userid];
                await User.updateOne({ _id: userid }, { $push: { logs: `[${new Date().toLocaleString()}][CIKIS] Tüm ihaleler sonlandırıldı.` } });
            }
        }
    } catch (error) {
        console.log(error);
    }
};

const updateAuthCredentials = async (userid, tckn, password) => {
    if (Workers.hasOwnProperty(userid)) {
        Workers[userid]['authWorker'].postMessage({ op: 1, tckn, password });
    }
};

const updateAuctionDetails = async (userid, auctionid, maxBid) => {
    if (Workers.hasOwnProperty(userid) && Workers[userid]['auctionWorkers'].hasOwnProperty(auctionid)) {
        Workers[userid]['auctionWorkers'][auctionid].postMessage({ op: 1, maxBid });
    }
};

const initWorkers = async () => {
    const auctions = await Auction.find({ isDone: false, isStopped: false });
    for (const auction of auctions) {
        await createAuctionWorker(auction._id);
    }
};

module.exports = { initWorkers, createAuctionWorker, deleteAuctionWorker, updateAuthCredentials, updateAuctionDetails };