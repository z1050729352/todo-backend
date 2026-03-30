const mongoose = require('mongoose');

const scoreSchema = new mongoose.Schema({
    playerName: {
        type: String,
        required: true,
        trim: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // 允许旧数据暂时为空
    },
    score: {
        type: Number,
        required: true,
        min: 0
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        required: true
    },
    gameType: {
        type: String,
        required: true,
        default: 'plane-war'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// 创建索引以优化排行榜查询
scoreSchema.index({ score: -1, createdAt: -1 });

module.exports = mongoose.model('Score', scoreSchema);
