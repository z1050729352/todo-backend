require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongoUrl = process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://localhost:27017/planegame';
  await mongoose.connect(mongoUrl);
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  const hasScores = collections.some((c) => c.name === 'scores');
  if (hasScores) {
    const backup = `backup_scores_${Date.now()}`;
    await db.collection('scores').rename(backup);
    process.stdout.write(`renamed scores -> ${backup}\n`);
  } else {
    process.stdout.write('scores collection not found\n');
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});

