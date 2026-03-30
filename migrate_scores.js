const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Score = require('./models/Score');

async function migrate() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/my-first-api');
        console.log('Connected.');
        
        console.log('Migrating scores...');
        const result = await Score.updateMany(
            { gameType: { $exists: false } },
            { $set: { gameType: 'plane-war' } }
        );
        
        console.log(`Migration complete. Modified ${result.modifiedCount} records.`);
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

migrate();
