const { isMainThread, parentPort, workerData } = require('worker_threads');
const puppeteer = require('puppeteer');
const xml2js = require('xml2js'); // XML'i JSON'a çevirmek için
let currentJSessionId = '';
let auctionData = {}; // İhale verilerini saklamak için
let recordId = ''; // Kayıt ID'sini saklamak için
let lastPlacedBid = null; // Son verilen teklif

let listeningUrl = '', maxPrice = 0;

const parseXMLResponse = (xml) => {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xml, { explicitArray: false }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
};

const updateSessionId = async (page, newSessionId) => {
    currentJSessionId = newSessionId;

    await page.setCookie({
        name: 'JSESSIONID',
        value: currentJSessionId,
        domain: 'esatis.uyap.gov.tr',
        path: '/',
        httpOnly: true,
        secure: true,
    });

    parentPort.postMessage({ op: 2, value: 'JSESSIONID güncellendi.' });
};

const calculateRemainingTime = (endTime) => {
    const now = new Date();
    const end = new Date(endTime);
    const diff = Math.max(0, end - now);

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, totalSeconds: Math.floor(diff / 1000) };
};

const printRemainingTime = (remainingTime) => {
    parentPort.postMessage({ op: 2, value: `Kalan süre: ${remainingTime.days} gün, ${remainingTime.hours} saat, ${remainingTime.minutes} dakika, ${remainingTime.seconds} saniye` });
};

const updateAuctionData = async (responseBody) => {
    const parsed = await parseXMLResponse(responseBody);
    const auction = parsed.root['object-array'].IhaleTumBilgiDVO;

    auctionData = {
        minIncrement: parseFloat(auction.minTeklifArtisMiktari),
        lastOffer: parseFloat(auction.sonTeklif),
        endTime: new Date(auction.ihaleBitisZamani),
    };

    if (auction.kayitID) {
        recordId = auction.kayitID;
        parentPort.postMessage({ op: 2, value: 'Güncellenen Kayıt ID: ' + recordId });
    }

    if (auctionData.lastOffer + auctionData.minIncrement > maxPrice) {
        parentPort.postMessage({ op: 3, value: 'Maksimum fiyat aşıldı, dinleme durduruluyor.' });
    }

    parentPort.postMessage({ op: 0, value: auctionData });
};

const placeBid = async (page, bidAmount) => {
    const response = await page.evaluate(async (recordId, bidAmount) => {
        const response = await fetch('https://esatis.uyap.gov.tr/main/jsp/esatis/ihaleTeklifIslemleri_brd.ajx', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `kayitId=${recordId}&teklifMiktari=${bidAmount}`,
        });
        return await response.text();
    }, recordId, bidAmount);

    lastPlacedBid = bidAmount; // Son verilen teklifi güncelle
    parentPort.postMessage({ op: 2, value: 'Teklif gönderildi: ' + bidAmount });
    parentPort.postMessage({ op: 2, value: 'Sunucu yanıtı: ' + JSON.stringify(response) });
};

if (!isMainThread) {
    listeningUrl = workerData.url;
    maxPrice = workerData.maxBid;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await updateSessionId(page, workerData.cookie);

    parentPort.on('message', async (data) => {
        switch(data.op) {
            case 0:
                await updateSessionId(page, data.cookie);
                break;
            case 1:
                maxPrice = data.maxBid;
                break;
        }    
    });

    page.on('response', async (response) => {
        if (response.url() === "https://esatis.uyap.gov.tr/main/jsp/esatis/ihale_detay_bilgileri_brd.ajx" ||
            response.url() === "https://esatis.uyap.gov.tr/main/jsp/esatis/ihale_detay_bilgileri_ozet_brd.ajx") {
            const responseBody = await response.text();
            await updateAuctionData(responseBody);
        }
    });

    await page.goto(listeningUrl, { waitUntil: 'networkidle2' });

    parentPort.postMessage({ op: 2, value: 'Dinleme başladı...' });
    const interval = setInterval(async () => {
        if (auctionData.endTime) {
            const remainingTime = calculateRemainingTime(auctionData.endTime);
            printRemainingTime(remainingTime);
            if (remainingTime.totalSeconds === 0) {
                parentPort.postMessage({ op: 4, value: 'İhale bitti.' });
            }

            if (remainingTime.totalSeconds <= 5) {
                const nextBid = auctionData.lastOffer + auctionData.minIncrement;

                if (auctionData.lastOffer === lastPlacedBid) {
                    parentPort.postMessage({ op: 2, value: 'Son teklif bizim verdiğimiz teklif, tekrar teklif verilmiyor.' });
                } else if (nextBid <= maxPrice) {
                    await placeBid(page, nextBid);
                } else {
                    parentPort.postMessage({ op: 3, value: 'Maksimum fiyat aşıldı, dinleme durduruluyor.' });
                }
            }
        }
    }, 1000);
}