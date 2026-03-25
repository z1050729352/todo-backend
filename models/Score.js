const mongoose = require('mongoose');

const scoreSchema = new mongoose.Schema({
    playerName: {
        type: String,
        required: true,
        trim: true
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
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// 创建索引以优化排行榜查询
scoreSchema.index({ score: -1, createdAt: -1 });

module.exports = mongoose.model('Score', scoreSchema);
