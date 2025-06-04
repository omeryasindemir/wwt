const express = require('express');
const cors = require("cors");
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const User = require('./models/user');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const auctionRouter = require('./routes/auction');
const { initWorkers } = require('./utils/workers');
const logger = require('morgan');

mongoose.connect("mongodb://127.0.0.1:27017/wwt").then(
    async () => {
        console.log('Connected to mongoDB');
        const admin = await User.findOne({isAdmin: true});
        if (admin) {
            console.log(`Admin account key: ${admin._id}`);
        } else {
            const user = new User({tckn: 11111111110, password: '', isAdmin: true});
            const persistedUser = await user.save();
            console.log(`Admin account key: ${persistedUser._id}`);
        }
        console.log('Starting workers...');
        await initWorkers();
    },
    (err) => console.log('Error connecting to mongoDB', err)
);

const app = express();

app.use(cors({
    origin: "https://www.winwiththat.com",
    credentials: true
}));
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/auction', auctionRouter);

app.listen(3001, () => {
    console.log(`Server running on port 3001`);
});

module.exports = app;
