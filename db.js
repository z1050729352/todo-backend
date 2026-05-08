const mongoose = require('mongoose');

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

async function connectDB() {
    try {
        const mongoUrl = process.env.MONGODB_URL
            || process.env.MONGODB_URI
            || process.env.MONGO_URL
            || 'mongodb://localhost:27017/planegame';

        await mongoose.connect(mongoUrl, {
            // 连接池：1GB 内存的服务器，5 个连接够用
            maxPoolSize: 5,
            minPoolSize: 1,
            // 连接超时
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            // 心跳检测
            heartbeatFrequencyMS: 10000,
        });

        console.log('数据库连接成功');

        mongoose.connection.on('disconnected', () => {
            console.log('数据库连接已断开，等待自动重连...');
        });
        mongoose.connection.on('reconnected', () => {
            console.log('数据库已重连');
        });
        mongoose.connection.on('error', (err) => {
            console.error('数据库连接异常', err.message);
        });
    } catch (error) {
        console.error('数据库连接失败:', error.message);
        console.log('服务器继续运行，数据库功能暂不可用');
    }
}

module.exports = connectDB;
