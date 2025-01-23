const User = require('../models/user');

const adminCheck = async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.session.userId });
    if(!user.isAdmin) {
      throw new Error('');
    }
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

module.exports = { adminCheck };