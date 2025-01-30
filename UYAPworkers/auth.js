const { isMainThread, parentPort, workerData } = require('worker_threads');
const puppeteer = require('puppeteer');
const axios = require('axios');

const loginAndSaveSession = async (tc, password) => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://esatis.uyap.gov.tr/main/esatis/giris.jsp', {
        waitUntil: 'networkidle2',
    });

    await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('strong')).find(el => el.textContent.trim() === "E-Şifre Aracılığıyla Giriş");
        if (button) button.click();
    });

    await page.waitForSelector('#tridField');
    await page.type('#tridField', tc.toString(), { delay: 100 });
    await page.type('#egpField', password, { delay: 100 });
    await page.click('button[name="submitButton"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    const cookies = await page.cookies();
    const jsessionidCookie = cookies.find(cookie => cookie.name === 'JSESSIONID');

    if (jsessionidCookie) {
        parentPort.postMessage({ op: 2, value: 'Yeni JSESSIONID kaydedildi.' });
    } else {
        parentPort.postMessage({ op: 1, value: 'JSESSIONID bulunamadı!' });
    }

    await browser.close();
    return jsessionidCookie ? jsessionidCookie.value : null;
}

// Yetkilendirilmiş istek fonksiyonu
const makeAuthenticatedRequest = async (cookieValue) => {
    try {
        const response = await axios.post(
            'https://esatis.uyap.gov.tr/main/esatis/ihaleKelimeArama_brd.ajx',
            new URLSearchParams({ searchWord: 'araba', pageNumber: '1' }),
            { headers: { Cookie: `JSESSIONID=${cookieValue}` } }
        );

        if (response.status === 200) {
            return true;
        }
    } catch (error) {
        parentPort.postMessage({ op: 2, value: 'Mevcut cookie geçerli değil. Yeniden giriş yapılıyor.' });
    }
    return false;
}

// Ana işlem
(async () => {
    if (!isMainThread) {
        try {
            let { tckn, password, cookie } = workerData;

            let isAuthenticated = false;

            // Oturum geçerliliğini kontrol eden fonksiyon
            const checkSessionValidity = async () => {
                parentPort.postMessage({ op: 2, value: 'Cookie işlemleri başlatıldı.' });
                while (true) {
                    // Oturum geçerliliğini kontrol et
                    if (cookie) {
                        isAuthenticated = await makeAuthenticatedRequest(cookie);
                    }

                    // Kimlik doğrulama başarısızsa tekrar giriş yap
                    if (!isAuthenticated) {
                        cookie = await loginAndSaveSession(tckn, password);
                        if (cookie) {
                            console.log(cookie);
                            parentPort.postMessage({ op: 0, value: cookie });
                        }
                    }

                    // Kontrolden önce 4 saniye bekle
                    await new Promise(resolve => setTimeout(resolve, 4000));
                }
            };

            parentPort.on('message', (data) => {
                switch (data.op) {
                    case 0:
                        if(cookie){
                            parentPort.postMessage({ op: 0, value: cookie });
                        }
                        break;
                    case 1:
                        tckn = data.tckn;
                        password = data.password;
                        break;
                }
            });

            // Oturum kontrolünü başlat
            await checkSessionValidity();
        } catch (error) {
            parentPort.postMessage({ op: 1, value: error });
        }
    }
})();