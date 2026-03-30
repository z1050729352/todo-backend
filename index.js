const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const connectDB = require('./db')
const Todo = require('./models/Todo');
const Score = require('./models/Score');
const User = require('./models/User');
const Friend = require('./models/Friend');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./authMiddleware');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('UnhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
    console.error('UncaughtException', err);
    process.exit(1);
});

connectDB();

app.use(express.json())
app.use(cors())

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (!req.path.startsWith('/api')) return next();
    if (mongoose.connection.readyState === 1) return next();
    return res.status(503).json({ error: '数据库未连接，请稍后重试' });
});

// --- 用户认证 API ---

app.get('/api/auth/check-username', async (req, res) => {
    try {
        const username = (req.query.username || '').toString().trim();
        if (!username) return res.status(400).json({ error: '缺少 username' });
        const existingUser = await User.exists({ username });
        return res.json({ exists: Boolean(existingUser) });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

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
        const { score, difficulty, gameType, customPlayerName } = req.body;
        const playerName = customPlayerName || req.user.username; 
        const userId = req.user.id; // 从 JWT 中获取用户 ID
        
        if (score === undefined || !difficulty) {
            return res.status(400).json({ error: '缺少必要参数' });
        }
        
        const newScore = new Score({ 
            playerName, 
            userId, // 保存 userId，用于区分已鉴权数据
            score, 
            difficulty,
            gameType: gameType || 'plane-war'
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
        const { difficulty, gameType, limit = 50 } = req.query;
        const query = {};
        if (difficulty) query.difficulty = difficulty;
        if (gameType) query.gameType = gameType;
        
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
            gameType: score.gameType,
            $or: [
                { score: { $gt: score.score } },
                { score: score.score, createdAt: { $lt: score.createdAt } }
            ]
        }) + 1;
        
        res.json({ rank, total: await Score.countDocuments({ difficulty: score.difficulty, gameType: score.gameType }) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- 好友系统 API ---

// 搜索用户
app.get('/api/friends/search', authMiddleware, async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.status(400).json({ error: '缺少搜索关键字' });
        if (username === req.user.username) return res.status(400).json({ error: '不能搜索自己' });
        
        const user = await User.findOne({ username }, 'username _id');
        if (!user) return res.status(404).json({ error: '用户不存在' });
        
        // 检查是否已经是好友或已发送请求
        const existingFriend = await Friend.findOne({
            $or: [
                { requester: req.user.id, recipient: user._id },
                { requester: user._id, recipient: req.user.id }
            ]
        });
        
        res.json({ user, relation: existingFriend ? existingFriend.status : 'none' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 发送好友请求
app.post('/api/friends/request', authMiddleware, async (req, res) => {
    try {
        const { targetUserId } = req.body;
        if (targetUserId === req.user.id) return res.status(400).json({ error: '不能添加自己' });
        
        const existing = await Friend.findOne({
            $or: [
                { requester: req.user.id, recipient: targetUserId },
                { requester: targetUserId, recipient: req.user.id }
            ]
        });
        
        if (existing) return res.status(400).json({ error: '请求已存在或已经是好友' });
        
        const friendRequest = new Friend({ requester: req.user.id, recipient: targetUserId });
        await friendRequest.save();
        
        res.status(201).json({ message: '好友请求已发送' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 处理好友请求 (accept/reject)
app.post('/api/friends/handle', authMiddleware, async (req, res) => {
    try {
        const { requestId, action } = req.body; // action: 'accepted' | 'rejected'
        if (!['accepted', 'rejected'].includes(action)) return res.status(400).json({ error: '无效的操作' });
        
        const request = await Friend.findOne({ _id: requestId, recipient: req.user.id, status: 'pending' });
        if (!request) return res.status(404).json({ error: '请求不存在' });
        
        if (action === 'rejected') {
            await Friend.deleteOne({ _id: requestId });
            return res.json({ message: '已拒绝' });
        }
        
        request.status = 'accepted';
        await request.save();
        res.json({ message: '已接受好友请求' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 获取好友列表与请求列表
app.get('/api/friends', authMiddleware, async (req, res) => {
    try {
        const friends = await Friend.find({
            $or: [
                { requester: req.user.id, status: 'accepted' },
                { recipient: req.user.id, status: 'accepted' }
            ]
        }).populate('requester recipient', 'username');
        
        const requests = await Friend.find({
            recipient: req.user.id,
            status: 'pending'
        }).populate('requester', 'username');
        
        // 格式化好友列表
        const formattedFriends = friends.map(f => {
            const isRequester = f.requester._id.toString() === req.user.id;
            const friendUser = isRequester ? f.recipient : f.requester;
            return {
                id: friendUser._id,
                username: friendUser.username,
                friendshipId: f._id
            };
        });
        
        res.json({ friends: formattedFriends, requests });
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

// --- Socket.io 逻辑 ---
const userSockets = new Map(); // userId -> socketId
const rooms = new Map(); // roomId -> { players: [userId1, userId2], gameType: '', gameState: {} }

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('认证失败'));
    jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret', (err, decoded) => {
        if (err) return next(new Error('认证失败'));
        socket.userId = decoded.id;
        socket.username = decoded.username;
        next();
    });
});

io.on('connection', (socket) => {
    userSockets.set(socket.userId, socket.id);
    
    // 广播上线状态给好友
    socket.on('get_online_status', async (friendIds) => {
        const onlineStatus = {};
        friendIds.forEach(id => {
            onlineStatus[id] = userSockets.has(id);
        });
        socket.emit('online_status_update', onlineStatus);
    });

    socket.on('invite_friend', ({ friendId, gameType }) => {
        const friendSocketId = userSockets.get(friendId);
        if (friendSocketId) {
            io.to(friendSocketId).emit('game_invite', {
                fromUserId: socket.userId,
                fromUsername: socket.username,
                gameType
            });
        }
    });

    socket.on('accept_invite', ({ fromUserId, gameType }) => {
        const friendSocketId = userSockets.get(fromUserId);
        if (friendSocketId) {
            const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            rooms.set(roomId, { players: [fromUserId, socket.userId], gameType, gameState: {} });
            
            // 让双方加入房间
            const fromSocket = io.sockets.sockets.get(friendSocketId);
            if (fromSocket) {
                fromSocket.join(roomId);
                fromSocket.emit('room_joined', { roomId, gameType, role: 'host', opponentName: socket.username });
            }
            socket.join(roomId);
            socket.emit('room_joined', { roomId, gameType, role: 'guest', opponentName: fromSocket ? fromSocket.username : 'Host' });
        }
    });

    socket.on('suggest_game_settings', ({ roomId, settings }) => {
        socket.to(roomId).emit('game_settings_suggested', settings);
    });

    socket.on('agree_game_settings', ({ roomId, settings }) => {
        // Broadcast start to everyone in the room
        const seed = Date.now();
        io.to(roomId).emit('start_multiplayer_game', { ...settings, seed });
    });

    socket.on('reject_invite', ({ fromUserId }) => {
        const friendSocketId = userSockets.get(fromUserId);
        if (friendSocketId) {
            io.to(friendSocketId).emit('invite_rejected', { username: socket.username });
        }
    });

    socket.on('game_action', ({ roomId, action }) => {
        // 广播给房间内其他玩家
        socket.to(roomId).emit('game_action', { fromUserId: socket.userId, action });
    });

    socket.on('disconnect', () => {
        userSockets.delete(socket.userId);
        // 通知可能在同一个房间的对手
        rooms.forEach((room, roomId) => {
            if (room.players.includes(socket.userId)) {
                socket.to(roomId).emit('opponent_disconnected');
            }
        });
    });
});

const PORT = Number(process.env.PORT || 12580);
server.listen(PORT, '0.0.0.0', () => {
    console.log(`API/Socket listening on http://localhost:${PORT}`);
});
