const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const Score = require('./models/Score');

async function clean() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/my-first-api');
        console.log('Connected.');
        
        console.log('Cleaning Tetris scores...');
        const result = await Score.deleteMany({ gameType: 'tetris' });
        
        console.log(`Cleanup complete. Deleted ${result.deletedCount} records.`);
    } catch (error) {
        console.error('Cleanup failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

clean();
