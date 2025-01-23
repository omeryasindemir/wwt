const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  tckn: {
    type: Number,
    default: null
  },
  password: {
    type: String,
    default: null
  },
  cookie: {
    type: String,
    default: null
  },
  credits: {
    type: Number,
    default: 0
  },
  logs: [String],
  isAdmin: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('User', UserSchema);