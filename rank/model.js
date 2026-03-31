const mongoose = require('mongoose');

const rankSchema = new mongoose.Schema(
  {
    game: { type: String, required: true, index: true },
    mode: { type: String, required: true, index: true },
    playerId: { type: String, required: true, index: true },
    score: { type: Number, required: true, index: true },
    partnerScore: { type: Number },
    rankScore: { type: Number, required: true, index: true },
    duration: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now, index: true },
    roomId: { type: String },
    partnerId: { type: String }
  },
  { versionKey: false }
);

rankSchema.index({ game: 1, mode: 1, rankScore: -1, timestamp: -1, _id: -1 });

function getRankModel(game) {
  const g = String(game || '').trim().toLowerCase();
  const modelName = `${g}_rank_model`;
  const collectionName = `${g}_rank`;
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  return mongoose.model(modelName, rankSchema, collectionName);
}

module.exports = { getRankModel };
