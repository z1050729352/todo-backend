const express = require('express');
const connectDB = require('./db')
const Todo = require('./models/Todo');
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