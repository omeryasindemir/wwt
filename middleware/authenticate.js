const User = require('../models/user');
const Session = require('../models/session');

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (typeof token !== 'string') {
      throw new Error('Çerez geçersiz');
    }
    const session = await Session.findOne({ token, status: 'valid' });
    if (!session) {
      res.clearCookie('token');
      throw new Error('Oturum zaman aşımına uğradı. Tekrar giriş yapınız');
    }
    req.session = session;
    next();
  } catch (err) {
    res.status(401).json({
      errors: [
        {
          title: 'Yetki Hatası',
          detail: err.message,
        },
      ],
    });
  }
};

module.exports = { authenticate };