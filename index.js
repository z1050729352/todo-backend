require('dotenv').config();
const express = require('express');
const connectDB = require('./db')
const Todo = require('./models/Todo');
const Score = require('./models/Score');
const User = require('./models/User');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./authMiddleware');

const app = express();

connectDB();

app.use(express.json())
app.use(cors())

// --- 用户认证 API ---

// 注册
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        if (username.length < 3) {
            return res.status(400).json({ error: '用户名至少3个字符' });
        }
        if (password.length < 8 || !/[A-Z]/.test(password)) {
            return res.status(400).json({ error: '密码至少8位且必须包含大写字母' });
        }
        
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: '用户名已存在' });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        
        res.status(201).json({ message: '注册成功' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 登录
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '用户名和密码不能为空' });
        }
        
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: '用户名或密码错误' });
        }
        
        const token = jwt.sign(
            { id: user._id, username: user.username },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '7d' }
        );
        
        res.json({
            message: '登录成功',
            token: token,
            user: { id: user._id, username: user.username }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 飞机大战排行榜 API ---

// 提交分数 (受保护)
app.post('/api/scores', authMiddleware, async (req, res) => {
    try {
        const { score, difficulty } = req.body;
        const playerName = req.user.username; 
        const userId = req.user.id; // 从 JWT 中获取用户 ID
        
        if (score === undefined || !difficulty) {
            return res.status(400).json({ error: '缺少必要参数' });
        }
        
        const newScore = new Score({ 
            playerName, 
            userId, // 保存 userId，用于区分已鉴权数据
            score, 
            difficulty 
        });
        await newScore.save();
        res.status(201).json(newScore);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 获取排行榜
app.get('/api/scores', async (req, res) => {
    try {
        const { difficulty, limit = 50 } = req.query;
        const query = difficulty ? { difficulty } : {};
        const scores = await Score.find(query)
            .sort({ score: -1, createdAt: -1 })
            .limit(parseInt(limit));
        res.json(scores);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取玩家排名
app.get('/api/scores/rank/:id', async (req, res) => {
    try {
        const score = await Score.findById(req.params.id);
        if (!score) return res.status(404).json({ error: '分数记录未找到' });
        
        const rank = await Score.countDocuments({
            difficulty: score.difficulty,
            $or: [
                { score: { $gt: score.score } },
                { score: score.score, createdAt: { $lt: score.createdAt } }
            ]
        }) + 1;
        
        res.json({ rank, total: await Score.countDocuments({ difficulty: score.difficulty }) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Todos API (受保护示例) ---
app.get('/api/todos', authMiddleware, async (req, res) => {
    try {
        const todos = await Todo.find();
        res.json(todos);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(12580, () => {
    console.log('12580一按我帮您 端口开启！')
})
