const mongoose = require('mongoose');

async function connectDB() {
    try {
        const mongoUrl = process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/planegame';
        await mongoose.connect(mongoUrl);
        console.log('数据库连接成功');
    } catch (error) {
        console.error('数据库连接失败', error);
        console.log('继续运行服务器，但数据库功能不可用');
        // 不退出进程，允许服务器继续运行
    }
}

module.exports = connectDB;

