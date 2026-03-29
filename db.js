const mongoose = require('mongoose');

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

async function connectDB() {
    try {
        const mongoUrl = process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/planegame';
        const hasExplicitMongoUrl = Boolean(process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URL);
        if (!hasExplicitMongoUrl && process.env.NODE_ENV === 'production') {
            console.log('未检测到 MONGODB_URL/MONGODB_URI/MONGO_URL，当前使用默认本地 Mongo 地址');
        }
        await mongoose.connect(mongoUrl);
        console.log('数据库连接成功');
        mongoose.connection.on('disconnected', () => {
            console.log('数据库连接已断开');
        });
        mongoose.connection.on('error', (err) => {
            console.error('数据库连接异常', err);
        });
    } catch (error) {
        console.error('数据库连接失败', error);
        console.log('继续运行服务器，但数据库功能不可用');
        // 不退出进程，允许服务器继续运行
    }
}

module.exports = connectDB;
