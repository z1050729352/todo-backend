const express = require('express');
const connectDB = require('./db')
const Todo = require('./models/Todo');
const Score = require('./models/Score');
const cors = require('cors');

const app = express();

connectDB();

app.use(express.json())
app.use(cors())

app.get('/api/todos', async (req, res) => {
    try {
        const todos = await Todo.find();
        res.json(todos);
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

app.post('/api/todos', async (req, res) => {
    try {
        const todo = new Todo({
            title: req.body.title
        })
        await todo.save();
        res.status(201).json(todo)
    } catch (error) {
        res.status(400).json({ error: error.message })
    }
})

app.put('/api/todos/:id', async (req, res) => {
    try {
        const todo = await Todo.findByIdAndUpdate(req.params.id, req.body, {
            returnDocument: 'after', //返回更新后的数据
        });
        if (!todo) return res.status(404).json({ error: '未找到' });
        res.json(todo)
    } catch (error) {
        res.status(400).json({ error: error.message })
    }
})

app.delete('/api/todos/:id', async (req, res) => {
    try {
        const todo = await Todo.findByIdAndDelete(
            req.params.id
        )
        if (!todo) return res.status(404).json({ error: '未找到' });
        res.sendStatus(204)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// 飞机大战排行榜API
// 提交分数
app.post('/api/scores', async (req, res) => {
    try {
        const { playerName, score, difficulty } = req.body;
        
        if (!playerName || score === undefined || !difficulty) {
            return res.status(400).json({ error: '缺少必要参数' });
        }
        
        const newScore = new Score({
            playerName,
            score,
            difficulty
        });
        
        await newScore.save();
        res.status(201).json(newScore);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// 获取排行榜（支持按难度筛选）
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
        if (!score) {
            return res.status(404).json({ error: '分数记录未找到' });
        }
        
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

app.listen(12580, () => {
    console.log('12580一按我帮您 端口开启！')
})



// // 本地接口mock
// let todos = [
//     {
//         id: 1,
//         title: 'wocao',
//         completed: false,
//     },
//     {
//         id: 2,
//         title: 'wocao1',
//         completed: false,
//     },
//     {
//         id: 3,
//         title: 'wocao2',
//         completed: false,
//     },
//     {
//         id: 4,
//         title: 'wocao3',
//         completed: false,
//     },
// ];

// // 获取全部
// app.get('/api/todos', (req, res) => {
//     res.json(todos)
// })

// // 获取单个
// app.get('/api/todos/:id', (req, res) => {
//     const todoItem = todos.find(i => i.id === parseInt(req.params.id))
//     if (!todoItem) return res.status(404).json({ error: '未找到' })
//     res.json(todoItem)
// })

// // 创建
// app.post('/api/todos', (req, res) => {
//     const todo = {
//         id: todos.length + 1,
//         title: req.body.title,
//         completed: req.body.completed,
//     }
//     todos.push(todo);
//     res.status(201).json(todo)
// })

// // 更新
// app.put('/api/todos/:id', (req, res) => {
//     const todoItem = todos.find(i => i.id === parseInt(req.params.id))
//     if (!todoItem) return res.status(404).json({ error: '未找到' })

//     todoItem.title = req.body.title || todoItem.title;
//     todoItem.completed = req.body.completed ?? todoItem.completed;

//     res.json(todoItem)
// })

// // 删除  
// app.delete('/api/todos/:id', (req, res) => {
//     const index = todos.findIndex(t => t.id === parseInt(req.params.id));
//     if (index === -1) return res.status(404).json({ error: '未找到' });

//     todos.splice(index, 1);
//     // res.status(204).send();
//     res.sendStatus(204)
// });


// app.listen(12580, () => {
//     console.log('当前服务运行在12580端口')
// })