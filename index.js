const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const connectDB = require('./db')
const Todo = require('./models/Todo');
const Score = require('./models/Score');
const User = require('./models/User');
const Friend = require('./models/Friend');
const { getRankConfig, isSupportedGameMode, normalizeGame, normalizeMode } = require('./rank/config');
const { submitRank, getTopRanks } = require('./rank/service');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const authMiddleware = require('./authMiddleware');
const http = require('http');
const { Server } = require('socket.io');
const {
    createPlaneRoomState,
    ensurePlanePlayers,
    applyHostWorldPatch,
    applyPlaneDamage,
    applyPlayerSnapshot,
    handleEnemyKilled,
    removeEnemy,
    shouldBroadcast,
    buildBroadcastPayload
} = require('./planeAuthority');
const { createInviteRegistry } = require('./realtime/inviteRegistry');
const { createFriendsSubscriptions } = require('./realtime/friendsSubscriptions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const userSockets = new Map();
const rooms = new Map();
const friendSubs = createFriendsSubscriptions();
const inviteRegistry = createInviteRegistry();

function getUserSocketIds(userId) {
    const set = userSockets.get(String(userId || ''));
    if (!set || set.size === 0) return [];
    return Array.from(set);
}

function emitToUser(userId, event, payload) {
    const ids = getUserSocketIds(userId);
    for (const socketId of ids) {
        io.to(socketId).emit(event, payload);
    }
}

function isUserOnline(userId) {
    const set = userSockets.get(String(userId || ''));
    return Boolean(set && set.size > 0);
}

function touchRoom(room) {
    if (!room) return;
    room.lastActiveAt = Date.now();
}

function buildRoomState(room) {
    if (!room) return null;
    const players = Array.isArray(room.players) ? room.players : [];
    const names = room.usernames && typeof room.usernames === 'object' ? room.usernames : {};
    return {
        roomId: room.roomId,
        hostId: room.hostId,
        gameType: room.gameType || null,
        settings: room.settings || null,
        seed: room.seed || null,
        players: players.map((id) => ({
            id,
            username: names[id] || null,
            online: isUserOnline(id),
            ready: Boolean(room.ready && room.ready[id])
        }))
    };
}

function ensureRoomHost(room) {
    if (!room || !Array.isArray(room.players) || room.players.length === 0) return null;
    if (room.players.includes(room.hostId) && isUserOnline(room.hostId)) return room.hostId;
    const next = room.players.find((p) => isUserOnline(p));
    if (next) room.hostId = next;
    return room.hostId;
}

function broadcastRoomState(roomId, room) {
    const state = buildRoomState(room);
    if (!state) return;
    io.to(roomId).emit('room_state', state);
}

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
    if (req.path.startsWith('/api/room')) return next();
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
        const { score, difficulty, gameType, customPlayerName, gameMode, duel } = req.body;
        const playerName = customPlayerName || req.user.username; 
        const userId = req.user.id; // 从 JWT 中获取用户 ID
        
        if (score === undefined || !difficulty) {
            return res.status(400).json({ error: '缺少必要参数' });
        }

        const mode = gameMode === 'duel' ? 'duel' : 'solo';
        let duelData = undefined;
        if (mode === 'duel') {
            if (!duel || typeof duel !== 'object') {
                return res.status(400).json({ error: '缺少对战数据' });
            }
            const aScore = Number(duel.aScore);
            const bScore = Number(duel.bScore);
            if (!Number.isFinite(aScore) || !Number.isFinite(bScore) || aScore < 0 || bScore < 0) {
                return res.status(400).json({ error: '对战分数不合法' });
            }
            duelData = {
                aName: duel.aName || 'A',
                bName: duel.bName || 'B',
                aScore,
                bScore,
                replay: duel.replay
            };
        }
        
        const newScore = new Score({ 
            playerName, 
            userId, // 保存 userId，用于区分已鉴权数据
            score, 
            difficulty,
            gameMode: mode,
            duel: duelData,
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
        const { difficulty, gameType, gameMode, limit = 50 } = req.query;
        const query = {};
        if (difficulty) query.difficulty = difficulty;
        if (gameType) query.gameType = gameType;
        if (gameMode) query.gameMode = gameMode;
        
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
            gameMode: score.gameMode || 'solo',
            $or: [
                { score: { $gt: score.score } },
                { score: score.score, createdAt: { $lt: score.createdAt } }
            ]
        }) + 1;
        
        res.json({ rank, total: await Score.countDocuments({ difficulty: score.difficulty, gameType: score.gameType, gameMode: score.gameMode || 'solo' }) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/rank/config', (req, res) => {
    res.json({ games: getRankConfig() });
});

app.get('/api/rank/:game/:mode', async (req, res) => {
    try {
        const game = normalizeGame(req.params.game);
        const mode = normalizeMode(req.params.mode);
        if (!isSupportedGameMode(game, mode)) return res.status(400).json({ error: '不支持的 game/mode' });
        const limit = Number(req.query.limit || 100);
        const data = await getTopRanks({ game, mode, limit });
        res.json({ items: data });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/rank/:game/:mode', authMiddleware, async (req, res) => {
    try {
        const game = normalizeGame(req.params.game);
        const mode = normalizeMode(req.params.mode);
        if (!isSupportedGameMode(game, mode)) return res.status(400).json({ error: '不支持的 game/mode' });

        const { score, partnerScore, duration, roomId, partnerId, timestamp } = req.body || {};
        if (!Number.isFinite(Number(score))) return res.status(400).json({ error: 'score 不合法' });

        const entry = await submitRank({
            game,
            mode,
            playerId: req.user.username,
            partnerId: partnerId ? String(partnerId) : undefined,
            score: Number(score),
            partnerScore: Number.isFinite(Number(partnerScore)) ? Number(partnerScore) : undefined,
            duration: Number.isFinite(Number(duration)) ? Number(duration) : 0,
            roomId: roomId ? String(roomId) : undefined,
            timestamp
        });
        res.status(201).json(entry);
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

        try {
            emitToUser(String(targetUserId), 'friend_request_created', {
                request: {
                    _id: String(friendRequest._id),
                    status: 'pending',
                    createdAt: friendRequest.createdAt,
                    requester: { _id: String(req.user.id), username: String(req.user.username || '') }
                }
            });
        } catch {}
        
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
        try {
            const requesterUser = await User.findById(request.requester, 'username');
            const recipientUser = await User.findById(request.recipient, 'username');
            if (requesterUser && recipientUser) {
                emitToUser(String(requesterUser._id), 'friend_added', { friend: { id: String(recipientUser._id), username: recipientUser.username } });
                emitToUser(String(recipientUser._id), 'friend_added', { friend: { id: String(requesterUser._id), username: requesterUser.username } });
            }
        } catch {}
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

// --- 房间 API ---

app.get('/api/room/state', authMiddleware, (req, res) => {
    const roomId = String(req.query.roomId || '');
    if (!roomId) return res.status(400).json({ error: '缺少 roomId' });
    const room = rooms.get(roomId);
    if (!room || !Array.isArray(room.players) || !room.players.includes(req.user.id)) {
        return res.status(404).json({ error: '房间不存在' });
    }
    return res.json(buildRoomState(room));
});

app.post('/api/room/setGame', authMiddleware, (req, res) => {
    const { roomId, gameType, settings } = req.body || {};
    const rid = String(roomId || '');
    const gt = String(gameType || '');
    if (!rid || !gt) return res.status(400).json({ error: '参数不完整' });
    if (!['plane-war', 'tetris'].includes(gt)) return res.status(400).json({ error: '不支持的 gameType' });
    const room = rooms.get(rid);
    if (!room || !Array.isArray(room.players) || !room.players.includes(req.user.id)) {
        return res.status(404).json({ error: '房间不存在' });
    }
    ensureRoomHost(room);
    if (room.hostId !== req.user.id) return res.status(403).json({ error: '仅房主可设置' });
    room.gameType = gt;
    room.settings = { ...(settings && typeof settings === 'object' ? settings : {}), gameType: gt };
    touchRoom(room);
    io.to(rid).emit('room_game_changed', { roomId: rid, gameType: gt, settings: room.settings });
    broadcastRoomState(rid, room);
    return res.json({ ok: true });
});

app.post('/api/room/ready', authMiddleware, (req, res) => {
    const { roomId, ready } = req.body || {};
    const rid = String(roomId || '');
    if (!rid) return res.status(400).json({ error: '缺少 roomId' });
    const room = rooms.get(rid);
    if (!room || !Array.isArray(room.players) || !room.players.includes(req.user.id)) {
        return res.status(404).json({ error: '房间不存在' });
    }
    if (!room.ready || typeof room.ready !== 'object') room.ready = {};
    room.ready[req.user.id] = Boolean(ready);
    touchRoom(room);
    io.to(rid).emit('room_player_ready', { roomId: rid, userId: req.user.id, ready: Boolean(ready) });
    broadcastRoomState(rid, room);
    return res.json({ ok: true });
});

app.post('/api/room/start', authMiddleware, (req, res) => {
    const { roomId } = req.body || {};
    const rid = String(roomId || '');
    if (!rid) return res.status(400).json({ error: '缺少 roomId' });
    const room = rooms.get(rid);
    if (!room || !Array.isArray(room.players) || !room.players.includes(req.user.id)) {
        return res.status(404).json({ error: '房间不存在' });
    }
    ensureRoomHost(room);
    if (room.hostId !== req.user.id) return res.status(403).json({ error: '仅房主可开始' });
    const players = room.players || [];
    const allNonHostReady = players.filter((p) => p !== room.hostId).every((p) => Boolean(room.ready && room.ready[p]));
    if (!allNonHostReady) return res.status(409).json({ error: '仍有玩家未准备' });
    if (!room.gameType) return res.status(409).json({ error: '尚未选择游戏' });
    const seed = Date.now();
    room.seed = seed;
    room.startedAt = Date.now();
    room.startAt = room.startedAt + 3500;
    if (room.gameType === 'plane-war') {
        room.planeState = createPlaneRoomState({ roomId: rid, roomSeed: seed, hostId: room.hostId, players: room.players });
    } else {
        room.planeState = null;
    }
    touchRoom(room);
    const payload = { roomId: rid, gameType: room.gameType, settings: room.settings || { gameType: room.gameType }, seed, startAt: room.startAt };
    io.to(rid).emit('room_game_start', payload);
    io.to(rid).emit('start_multiplayer_game', { ...(payload.settings || {}), gameType: room.gameType, seed });
    return res.json({ ok: true, seed });
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
    const uid = String(socket.userId || '');
    if (uid) {
        const set = userSockets.get(uid) || new Set();
        set.add(socket.id);
        userSockets.set(uid, set);
    }
    
    // 广播上线状态给好友
    socket.on('get_online_status', async (friendIds) => {
        const onlineStatus = {};
        (Array.isArray(friendIds) ? friendIds : []).forEach(id => {
            onlineStatus[String(id)] = isUserOnline(String(id));
        });
        socket.emit('online_status_update', onlineStatus);
    });

    socket.on('subscribe_friends_status', ({ friendIds }) => {
        friendSubs.replaceSubscription(socket.id, friendIds);
        const onlineStatus = {};
        const list = Array.isArray(friendIds) ? friendIds : [];
        for (const id of list) {
            const fid = String(id || '');
            if (!fid) continue;
            onlineStatus[fid] = isUserOnline(fid);
        }
        socket.emit('online_status_update', onlineStatus);
    });

    for (const watcherSocketId of friendSubs.getWatchers(uid)) {
        io.to(watcherSocketId).emit('friend_status_update', { friendId: uid, online: true, username: socket.username });
    }

    socket.on('invite_friend', ({ friendId, gameType }) => {
        const toUserId = String(friendId || '');
        const type = String(gameType || '');
        if (!toUserId || !type) return;
        const { inviteId } = inviteRegistry.createInvite({ fromUserId: uid, toUserId, gameType: type });
        const ids = getUserSocketIds(toUserId);
        if (ids.length === 0) return;
        for (const sid of ids) {
            io.to(sid).emit('game_invite', {
                inviteId,
                fromUserId: uid,
                fromUsername: socket.username,
                gameType: type
            });
        }
    });

    socket.on('accept_invite', ({ inviteId, fromUserId, gameType }) => {
        const id = String(inviteId || '');
        const from = String(fromUserId || '');
        const type = String(gameType || '');
        if (!id || !from || !type) return;

        const accepted = inviteRegistry.acceptInvite({ inviteId: id, toUserId: uid });
        if (!accepted.ok) return;

        const inv = inviteRegistry.getInvite(id);
        if (!inv || inv.gameType !== type || String(inv.fromUserId) !== from) return;

        if (inv.roomId) {
            socket.join(inv.roomId);
            socket.emit('room_joined', { roomId: inv.roomId, gameType: type, role: 'guest', opponentName: 'Host' });
            return;
        }

        const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        inviteRegistry.setInviteRoom({ inviteId: id, roomId });
        rooms.set(roomId, {
            roomId,
            players: [from, uid],
            hostId: from,
            gameType: type,
            settings: { gameType: type, difficulty: 'medium', timeLimit: 3 },
            ready: {},
            usernames: { [from]: 'Host', [uid]: socket.username },
            seed: null,
            planeState: null,
            createdAt: Date.now(),
            lastActiveAt: Date.now()
        });

        const hostSocketIds = getUserSocketIds(from);
        const hostSocketId = hostSocketIds[0];
        const hostSocket = hostSocketId ? io.sockets.sockets.get(hostSocketId) : null;
        const room = rooms.get(roomId);
        if (room && room.usernames && hostSocket && hostSocket.username) {
            room.usernames[from] = hostSocket.username;
        }
        if (hostSocket) {
            hostSocket.join(roomId);
            hostSocket.emit('room_joined', { roomId, gameType: type, role: 'host', opponentName: socket.username });
        }
        socket.join(roomId);
        socket.emit('room_joined', { roomId, gameType: type, role: 'guest', opponentName: hostSocket ? hostSocket.username : 'Host' });
    });

    socket.on('suggest_game_settings', ({ roomId, settings }) => {
        const room = rooms.get(roomId);
        if (room) touchRoom(room);
        socket.to(roomId).emit('game_settings_suggested', settings);
    });

    socket.on('agree_game_settings', ({ roomId, settings }) => {
        // Broadcast start to everyone in the room
        const seed = Date.now();
        const room = rooms.get(roomId);
        if (room) {
            touchRoom(room);
            room.seed = seed;
            if (room.gameType === 'plane-war') {
                room.planeState = createPlaneRoomState({ roomId, roomSeed: seed, hostId: room.hostId, players: room.players });
                room.planeNetMode = 'evt_tick';
            }
        }
        io.to(roomId).emit('start_multiplayer_game', { ...settings, seed });
    });

    socket.on('reject_game_settings', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (room) touchRoom(room);
        socket.to(roomId).emit('game_settings_rejected', { username: socket.username });
    });

    socket.on('reject_invite', ({ inviteId, fromUserId, gameType }) => {
        const id = String(inviteId || '');
        const from = String(fromUserId || '');
        const type = String(gameType || '');
        if (!id || !from || !type) return;
        const rejected = inviteRegistry.rejectInvite({ inviteId: id, toUserId: uid });
        if (!rejected.ok) return;
        emitToUser(from, 'invite_rejected', { username: socket.username });
    });

    socket.on('game_action', ({ roomId, action }) => {
        const room = rooms.get(roomId);
        if (room) touchRoom(room);
        // 广播给房间内其他玩家
        socket.to(roomId).emit('game_action', { fromUserId: socket.userId, action });
    });

    socket.on('plane_world_patch', ({ roomId, patch }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        touchRoom(room);
        ensurePlanePlayers(room.planeState, room.players);
        applyHostWorldPatch(room.planeState, socket.userId, patch);
    });

    socket.on('plane_evt', ({ roomId, payload }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war') return;
        if (socket.userId !== room.hostId) return;
        if (!payload || typeof payload !== 'object') return;
        touchRoom(room);
        socket.to(roomId).emit('plane_evt', { fromUserId: socket.userId, payload });
    });

    socket.on('plane_tick_sync', ({ roomId, payload }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war') return;
        if (socket.userId !== room.hostId) return;
        if (!payload || typeof payload !== 'object') return;
        touchRoom(room);
        socket.to(roomId).emit('plane_tick_sync', { fromUserId: socket.userId, payload });
    });

    socket.on('plane_state_hash', ({ roomId, payload }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war') return;
        if (socket.userId !== room.hostId) return;
        if (!payload || typeof payload !== 'object') return;
        touchRoom(room);
        socket.to(roomId).emit('plane_state_hash', { fromUserId: socket.userId, payload });
    });

    socket.on('plane_state_mismatch', ({ roomId, payload }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war') return;
        if (!payload || typeof payload !== 'object') return;
        touchRoom(room);
        const hostSocketIds = getUserSocketIds(room.hostId);
        const hostSocketId = hostSocketIds[0];
        if (!hostSocketId) return;
        io.to(hostSocketId).emit('plane_state_mismatch', { fromUserId: socket.userId, payload });
    });

    socket.on('plane_state_correct', ({ roomId, toUserId, payload }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war') return;
        if (socket.userId !== room.hostId) return;
        if (!payload || typeof payload !== 'object') return;
        touchRoom(room);
        const targetUserId = String(toUserId || '');
        if (targetUserId) {
            emitToUser(targetUserId, 'plane_state_correct', { fromUserId: socket.userId, payload });
            return;
        }
        socket.to(roomId).emit('plane_state_correct', { fromUserId: socket.userId, payload });
    });

    socket.on('plane_damage', ({ roomId, damage }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        touchRoom(room);
        ensurePlanePlayers(room.planeState, room.players);
        applyPlaneDamage(room.planeState, damage);
    });

    socket.on('plane_player_snapshot', ({ roomId, snapshot }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        touchRoom(room);
        ensurePlanePlayers(room.planeState, room.players);
        applyPlayerSnapshot(room.planeState, socket.userId, snapshot);
    });

    socket.on('plane_enemy_killed', ({ roomId, enemyId, x, y, difficulty }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        touchRoom(room);
        ensurePlanePlayers(room.planeState, room.players);
        // 传递难度参数，默认为 'medium'
        const drops = handleEnemyKilled(room.planeState, { enemyId, x, y, difficulty: difficulty || room.difficulty || 'medium' });
        for (const d of drops) {
            emitToUser(d.toUserId, 'plane_drop', d.drop);
        }
    });

    socket.on('plane_enemy_remove', ({ roomId, enemyId }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        touchRoom(room);
        ensurePlanePlayers(room.planeState, room.players);
        removeEnemy(room.planeState, enemyId);
    });

    socket.on('plane_snapshot_request', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        touchRoom(room);
        ensurePlanePlayers(room.planeState, room.players);
        socket.emit('plane_snapshot', buildBroadcastPayload(room.planeState).snapshot);
    });

    socket.on('rejoin_room', ({ roomId }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        touchRoom(room);
        socket.join(roomId);
        if (room.usernames && typeof room.usernames === 'object' && uid && socket.username) {
            room.usernames[uid] = socket.username;
        }
        broadcastRoomState(roomId, room);
        if (room.gameType === 'plane-war' && room.planeState) {
            ensurePlanePlayers(room.planeState, room.players);
            socket.emit('plane_snapshot', buildBroadcastPayload(room.planeState).snapshot);
        }
    });

    socket.on('leave_room', ({ roomId }) => {
        if (!roomId) return;
        const room = rooms.get(roomId);
        socket.leave(roomId);
        if (!room) return;
        touchRoom(room);
        if (Array.isArray(room.players)) room.players = room.players.filter((p) => p !== uid);
        if (room.ready && typeof room.ready === 'object') delete room.ready[uid];
        if (room.usernames && typeof room.usernames === 'object') delete room.usernames[uid];
        if (process.env.DEBUG_ROOMS === '1') console.log('[rooms] leave_room', { roomId, userId: uid, remaining: room.players });
        if (!room.players || room.players.length === 0) {
            rooms.delete(roomId);
            io.to(roomId).emit('room_disbanded', { roomId });
            return;
        }
        if (room.startedAt) {
            socket.to(roomId).emit('opponent_disconnected');
            rooms.delete(roomId);
            return;
        }
        const prevHost = room.hostId;
        if (prevHost === uid) {
            room.hostId = room.players[0];
            ensureRoomHost(room);
            io.to(roomId).emit('room_host_changed', { roomId, hostId: room.hostId });
        }
        broadcastRoomState(roomId, room);
    });

    socket.on('disconnect', () => {
        friendSubs.unsubscribeSocket(socket.id);
        if (uid) {
            const set = userSockets.get(uid);
            if (set) {
                set.delete(socket.id);
                if (set.size === 0) userSockets.delete(uid);
            }
            const online = isUserOnline(uid);
            for (const watcherSocketId of friendSubs.getWatchers(uid)) {
                io.to(watcherSocketId).emit('friend_status_update', { friendId: uid, online, username: socket.username });
            }
        }
        for (const roomId of socket.rooms) {
            if (roomId === socket.id) continue;
            const room = rooms.get(roomId);
            if (!room || !Array.isArray(room.players) || !room.players.includes(uid)) continue;
            touchRoom(room);
            if (room.startedAt) socket.to(roomId).emit('opponent_disconnected');
            broadcastRoomState(roomId, room);
        }
    });
});

const ROOM_CLEANUP_INTERVAL_MS = 5000;
const ROOM_EMPTY_TTL_MS = Number(process.env.ROOM_EMPTY_TTL_MS || 120000);

setInterval(() => {
    inviteRegistry.cleanup();
}, 30000);

setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
        if (!room || !Array.isArray(room.players)) {
            rooms.delete(roomId);
            continue;
        }
        const lastActiveAt = Number.isFinite(room.lastActiveAt) ? room.lastActiveAt : (Number.isFinite(room.createdAt) ? room.createdAt : 0);
        const anyOnline = room.players.some((p) => isUserOnline(p));
        if (anyOnline) continue;
        if (now - lastActiveAt >= ROOM_EMPTY_TTL_MS) {
            rooms.delete(roomId);
            if (process.env.DEBUG_ROOMS === '1') {
                console.log('[rooms] deleted empty room', roomId, { gameType: room.gameType, lastActiveAt });
            }
        }
    }
}, ROOM_CLEANUP_INTERVAL_MS);

setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, roomId) => {
        if (!room || room.gameType !== 'plane-war' || !room.planeState) return;
        if (room.planeNetMode === 'evt_tick') return;
        if (!Array.isArray(room.players) || !room.players.some((p) => isUserOnline(p))) return;
        if (!shouldBroadcast(room.planeState, now)) return;
        if (process.env.DEBUG_ROOMS === '1' && room.planeState.enemies && room.planeState.enemies.size > 800) {
            console.log('[plane] large enemies', roomId, room.planeState.enemies.size);
        }
        ensurePlanePlayers(room.planeState, room.players);
        const { changed, snapshot } = buildBroadcastPayload(room.planeState);
        room.planeState.lastBroadcastAt = now;
        if (changed) io.to(roomId).emit('plane_world_state', snapshot);
    });
}, 20);

const PORT = Number(process.env.PORT || 12580);
server.listen(PORT, '0.0.0.0', () => {
    console.log(`API/Socket listening on http://localhost:${PORT}`);
});
