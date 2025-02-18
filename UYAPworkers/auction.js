const { isMainThread, parentPort, workerData } = require('worker_threads');
const puppeteer = require('puppeteer');
const xml2js = require('xml2js'); // XML'i JSON'a çevirmek için
let currentJSessionId = '';
let auctionData = {}; // İhale verilerini saklamak için
let recordId = ''; // Kayıt ID'sini saklamak için
let lastPlacedBid = null; // Son verilen teklif

let listeningUrl = '', maxPrice = 0;
let isInLastTenSeconds = false; // 10 saniye modunu takip etmek için

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
    const diff = Math.max(-5, end - now);

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
    try {
        const parsed = await parseXMLResponse(responseBody);
        
        if (!parsed?.root?.['object-array']?.IhaleTumBilgiDVO) {
            parentPort.postMessage({ 
                op: 2, 
                value: 'Geçersiz ihale verisi alındı. XML yapısı: ' + JSON.stringify(parsed) 
            });
            return;
        }

        const auction = parsed.root['object-array'].IhaleTumBilgiDVO;
        const newLastOffer = parseFloat(auction.sonTeklif);

        // Eğer son 10 saniye modundaysak ve ihale bizde değilse hemen teklif ver
        if (isInLastTenSeconds && newLastOffer !== lastPlacedBid) {
            const nextBid = newLastOffer + parseFloat(auction.minTeklifArtisMiktari);
            if (nextBid <= maxPrice) {
                await placeBid(global.page, nextBid);
            } else {
                parentPort.postMessage({ op: 3, value: 'Maksimum fiyat aşıldı, dinleme durduruluyor.' });
            }
        }

        auctionData = {
            minIncrement: parseFloat(auction.minTeklifArtisMiktari),
            lastOffer: newLastOffer,
            endTime: new Date(auction.ihaleBitisZamani),
        };

        if (auction.kayitID) {
            recordId = auction.kayitID;
            parentPort.postMessage({ op: 2, value: `Güncellenen Kayıt ID: ${recordId}` });
        }

        if (auctionData.lastOffer + auctionData.minIncrement > maxPrice) {
            parentPort.postMessage({ op: 3, value: 'Maksimum fiyat aşıldı, dinleme durduruluyor.' });
        }

        parentPort.postMessage({ op: 0, value: auctionData });
    } catch (error) {
        parentPort.postMessage({ 
            op: 2, 
            value: `İhale verisi güncellenirken hata oluştu: ${error.message}\nYanıt: ${responseBody}` 
        });
    }
};

const placeBid = async (page, bidAmount) => {
    const parsed = await page.evaluate(async (recordId, bidAmount) => {
        try {
            const response = await fetch('https://esatis.uyap.gov.tr/main/jsp/esatis/ihaleTeklifIslemleri_brd.ajx', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `kayitId=${recordId}&teklifMiktari=${bidAmount}`
            });
            const data = await response.text();
            return JSON.parse(data);
        } catch (error) {
            return { errorCode: true, error: error.message };
        }
    }, recordId, bidAmount);

    if (parsed.hasOwnProperty('errorCode')) {
        if (parsed.error === 'Teklif Süresi Henüz Başlamamıştır, Teklif Veremezsiniz!') {
            const data = { reason: 'Teklif verilirken hata oluştu: İhale bitti.', isWon: (auctionData.lastOffer === lastPlacedBid) };
            parentPort.postMessage({ op: 4, value: data });
        } else {
            parentPort.postMessage({ op: 2, value: `Teklif verilirken hata oluştu: ${parsed.error}` });
        }
    } else if (parsed.type === 'success') {
        lastPlacedBid = bidAmount;
        parentPort.postMessage({ op: 6, value: bidAmount });
        parentPort.postMessage({ op: 2, value: `Teklif gönderildi: ${bidAmount}` });
    } else {
        parentPort.postMessage({ op: 2, value: `Beklenmeyen yanıt: ${JSON.stringify(parsed)}` });
    }
};

const waitforCookie = async (page) => {
    while (true) {
        await page.goto(listeningUrl, { waitUntil: 'networkidle2' });
        if (page.url() === listeningUrl) {
            parentPort.postMessage({ op: 2, value: 'Cookie geçerli.' });
            return;
        }
        parentPort.postMessage({ op: 2, value: 'Cookie geçerli değil. Tekrar deneniyor...' });
        parentPort.postMessage({ op: 5 });
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
};

(async () => {
    if (!isMainThread) {
        listeningUrl = workerData.url;
        maxPrice = workerData.maxBid;

        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        // Page nesnesini global olarak sakla
        global.page = page;

        parentPort.on('message', async (data) => {
            switch (data.op) {
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

        await waitforCookie(page);

        parentPort.postMessage({ op: 2, value: 'Dinleme başladı...' });
        const interval = setInterval(async () => {
            if (auctionData.endTime) {
                const remainingTime = calculateRemainingTime(auctionData.endTime);
                
                // Son 10 saniye moduna giriş
                if (remainingTime.totalSeconds <= 10 && !isInLastTenSeconds) {
                    isInLastTenSeconds = true;
                    parentPort.postMessage({ op: 2, value: 'Son 10 saniye moduna girildi.' });
                    
                    // Son 10 saniyeye girildiğinde eğer ihale bizde değilse hemen teklif ver
                    if (auctionData.lastOffer !== lastPlacedBid) {
                        const nextBid = auctionData.lastOffer + auctionData.minIncrement;
                        if (nextBid <= maxPrice) {
                            await placeBid(page, nextBid);
                        }
                    }
                }

                if (remainingTime.totalSeconds === -5) {
                    const data = { reason: 'İhale bitti.', isWon: (auctionData.lastOffer === lastPlacedBid) };
                    parentPort.postMessage({ op: 4, value: data });
                }
            }
        }, 1000);
    }
})();