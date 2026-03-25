const mongoose = require('mongoose');

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URL);
                console.log('数据库连接成功');
    } catch (error) {
        console.error('数据库连接失败', error);
        process.exit(1);
    }
}

module.exports = connectDB;

