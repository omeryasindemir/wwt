const express = require('express');

const User = require('../models/user');
const { authenticate } = require('../middleware/authenticate');
const { csrfCheck } = require('../middleware/csrfCheck');
const TCKNCheck = require('../utils/TCKNCheck');
const { updateAuthCredentials } = require('../utils/workers');
const initSession = require('../utils/initSession');

const router = express.Router();

router.post('/login', async (req, res) => {
    try {
        const { key } = req.body;
        if (typeof key !== 'string') {
            return res.status(400).json({
                error: 'Key geçersiz'
            });
        }

        console.log(key);

        const user = await User.findOne({ _id: key });
        if (!user) {
            throw new Error("invalid_key");
        }

        console.log("done1");

        const session = await initSession(user._id);

        console.log("done2");

        res
        .cookie('token', session.token, {
            httpOnly: true,
            sameSite: "None",
            maxAge: 1209600000,
            secure: true
        })
        .status(user.tckn === null ? 301 : 200)
        .json({
            title: 'Giriş başarılı',
            detail: 'Giriş işlemi başarıyla sonuçlandı',
            csrfToken: session.csrfToken,
        });
    } catch (err) {
        console.log(err);
        res.status(401).json({
            error: err,
        });
    }
});

router.post('/bindKey', authenticate, csrfCheck, async (req, res) => {
    try {
        const { tckn, password } = req.body;
        if (!TCKNCheck(tckn)) {
            return res.status(400).json({
                error: 'TC Kimlik Numarası Geçersiz'
            });
        }
        if (typeof password !== 'string') {
            return res.status(400).json({
                error: 'Şifre geçersiz'
            });
        }

        const user = await User.findOne({ _id: req.session.userId });
        user.tckn = tckn;
        user.password = password;
        await user.save();

        res.json({});
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

router.post('/manageKey', authenticate, csrfCheck, async (req, res) => {
    try {
        const { tckn, password } = req.body;
        

        const user = await User.findOne({ _id: req.session.userId });
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

router.get('/me', authenticate, csrfCheck, async (req, res) => {
    try {
        const user = await User.findOne({ _id: req.session.userId });

        res.json(user.toObject());
    } catch (err) {
        res.status(401).json({
            error: err,
        });
    }
});

module.exports = router;