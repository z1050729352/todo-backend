const mongoose = require('mongoose');
const Score = require('./models/Score');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MONGO_URL = process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/planegame';

async function cleanupOldScores() {
    try {
        await mongoose.connect(MONGO_URL);
        console.log('--- 数据库连接成功，开始清理旧数据 ---');

        // 删除所有没有 userId 的分数（即之前未鉴权的数据）
        const result = await Score.deleteMany({ userId: { $exists: false } });
        
        console.log(`清理完成！`);
        console.log(`成功删除了 ${result.deletedCount} 条未鉴权的旧分数记录。`);
        
        await mongoose.disconnect();
        console.log('--- 数据库已断开连接 ---');
    } catch (error) {
        console.error('清理失败:', error);
        process.exit(1);
    }
}

cleanupOldScores();
