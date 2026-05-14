require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');


const authRoutes = require('./routes/authRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const statsRoutes = require('./routes/statsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const userRoutes = require('./routes/userRoutes');
const staticRoutes = require('./routes/staticRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const { poolPromise } = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true
    }
});

const PORT = process.env.PORT || 5000;
// Store connected users (email -> socket.id)
const connectedUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    socket.on('register', (userEmail) => {
        connectedUsers.set(userEmail, socket.id);
        console.log(`User ${userEmail} registered with socket ${socket.id}`);
    });
    
    socket.on('disconnect', () => {
        for (const [email, id] of connectedUsers.entries()) {
            if (id === socket.id) {
                connectedUsers.delete(email);
                console.log(`User ${email} disconnected`);
                break;
            }
        }
    });
});

// Make io and connectedUsers available to routes
app.set('io', io);
app.set('connectedUsers', connectedUsers);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '100mb' })); // ← Added limit

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5000 });
app.use('/api/', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/static', staticRoutes);
app.use('/api/notifications', notificationRoutes);


app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

poolPromise.then(() => {
    app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
}).catch(err => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
});