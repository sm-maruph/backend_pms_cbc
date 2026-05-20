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

// ======================================================
// CORS - EXPLICIT HEADERS FOR EVERY RESPONSE
// ======================================================

// Custom middleware to add CORS headers to EVERY response
app.use((req, res, next) => {
    // Allow any origin
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, ngrok-skip-browser-warning');
    res.header('Access-Control-Allow-Credentials', 'false');
    res.header('Access-Control-Max-Age', '86400');

    // Handle preflight OPTIONS request immediately
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

// ======================================================
// Socket.IO with CORS
// ======================================================

const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        credentials: false,
        allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
    }
});

// ======================================================
// PORT
// ======================================================

const PORT = process.env.PORT || 5000;

// ======================================================
// Connected Users
// ======================================================

const connectedUsers = new Map();

// ======================================================
// Socket.IO Events
// ======================================================

io.on('connection', (socket) => {
    console.log('✅ New client connected:', socket.id);

    socket.on('register', (userEmail) => {
        connectedUsers.set(userEmail, socket.id);
        console.log(`✅ User ${userEmail} registered with socket ${socket.id}`);
    });

    socket.on('join-ticket-room', (ticketId) => {
        socket.join(`ticket_${ticketId}`);
        console.log(`✅ Socket ${socket.id} joined room ticket_${ticketId}`);
    });

    socket.on('leave-ticket-room', (ticketId) => {
        socket.leave(`ticket_${ticketId}`);
        console.log(`✅ Socket ${socket.id} left room ticket_${ticketId}`);
    });

    socket.on('disconnect', () => {
        for (const [email, id] of connectedUsers.entries()) {
            if (id === socket.id) {
                connectedUsers.delete(email);
                console.log(`❌ User ${email} disconnected`);
                break;
            }
        }
        console.log(`📊 Total connected users: ${connectedUsers.size}`);
    });
});

// ======================================================
// Helper Functions
// ======================================================

const emitToUser = (userEmail, eventName, data) => {
    const socketId = connectedUsers.get(userEmail);
    if (socketId) {
        io.to(socketId).emit(eventName, data);
        console.log(`📡 Emitted ${eventName} to user: ${userEmail}`);
        return true;
    }
    return false;
};

const emitToAll = (eventName, data) => {
    io.emit(eventName, data);
    console.log(`📡 Emitted ${eventName} to all connected users`);
};

// ======================================================
// Make Available Globally
// ======================================================

app.set('emitToUser', emitToUser);
app.set('emitToAll', emitToAll);
app.set('io', io);
app.set('connectedUsers', connectedUsers);

// ======================================================
// Trust Proxy
// ======================================================

app.set('trust proxy', 1);

// ======================================================
// Helmet - AFTER CORS (relaxed for CORS)
// ======================================================

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: false
}));

// ======================================================
// Request Logger
// ======================================================

app.use((req, res, next) => {
    console.log(`🌍 ${req.method} ${req.url} - Origin: ${req.headers.origin || 'unknown'}`);
    next();
});

// ======================================================
// JSON Parser
// ======================================================

app.use(express.json({ limit: '100mb' }));

// ======================================================
// Rate Limiter
// ======================================================

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

// ======================================================
// Routes
// ======================================================

app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/static', staticRoutes);
app.use('/api/notifications', notificationRoutes);

// ======================================================
// Health Check
// ======================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date(),
        cors: 'enabled'
    });
});

// ======================================================
// Global Error Handler
// ======================================================

app.use((err, req, res, next) => {
    console.error('❌ Global Error:', err.message);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

// ======================================================
// Start Server
// ======================================================

poolPromise
    .then(() => {
        console.log('✅ Connected to SQL Server');
        server.listen(PORT, () => {
            console.log(`🚀 Backend running on http://localhost:${PORT}`);
            console.log(`📡 CORS: Enabled for all origins (Access-Control-Allow-Origin: *)`);
            console.log(`🔌 Socket.IO ready`);
        });
    })
    .catch(err => {
        console.error('❌ Failed to connect to database:', err);
        process.exit(1);
    });

// require('dotenv').config();
// const express = require('express');
// const cors = require('cors');
// const helmet = require('helmet');
// const rateLimit = require('express-rate-limit');
// const http = require('http');
// const socketIo = require('socket.io');


// const authRoutes = require('./routes/authRoutes');
// const ticketRoutes = require('./routes/ticketRoutes');
// const statsRoutes = require('./routes/statsRoutes');
// const reportRoutes = require('./routes/reportRoutes');
// const userRoutes = require('./routes/userRoutes');
// const staticRoutes = require('./routes/staticRoutes');
// const notificationRoutes = require('./routes/notificationRoutes');

// const { poolPromise } = require('./config/db');

// const app = express();
// const server = http.createServer(app);
// const io = socketIo(server, {
//     cors: {
//         origin: process.env.FRONTEND_URL || 'https://cbc-it-incident-management.onrender.com', //http://localhost:5173
//         credentials: true
//     }
// });

// const PORT = process.env.PORT || 5000;
// // Store connected users (email -> socket.id)
// const connectedUsers = new Map();

// // Socket.IO connection handling
// io.on('connection', (socket) => {
//     console.log('New client connected:', socket.id);

//     socket.on('register', (userEmail) => {
//         connectedUsers.set(userEmail, socket.id);
//         console.log(`User ${userEmail} registered with socket ${socket.id}`);
//     });


//     // Join specific ticket room for real-time updates on that ticket
//     socket.on('join-ticket-room', (ticketId) => {
//         socket.join(`ticket_${ticketId}`);
//         console.log(`Socket ${socket.id} joined room ticket_${ticketId}`);
//     });

//     // Leave ticket room
//     socket.on('leave-ticket-room', (ticketId) => {
//         socket.leave(`ticket_${ticketId}`);
//         console.log(`Socket ${socket.id} left room ticket_${ticketId}`);
//     });

//     socket.on('disconnect', () => {
//         for (const [email, id] of connectedUsers.entries()) {
//             if (id === socket.id) {
//                 connectedUsers.delete(email);
//                 console.log(`User ${email} disconnected`);
//                 break;
//             }
//         }
//         console.log(`📊 Total connected users: ${connectedUsers.size}`);

//     });
// });

// // Helper function to emit to specific user (add this after io.on)
// const emitToUser = (userEmail, eventName, data) => {
//     const socketId = connectedUsers.get(userEmail);
//     if (socketId && io) {
//         io.to(socketId).emit(eventName, data);
//         console.log(`📡 Emitted ${eventName} to user: ${userEmail}`);
//         return true;
//     }
//     return false;
// };

// // Helper function to emit to all connected clients
// const emitToAll = (eventName, data) => {
//     io.emit(eventName, data);
//     console.log(`📡 Emitted ${eventName} to all connected clients`);
// };

// // Make helpers available to routes
// app.set('emitToUser', emitToUser);
// app.set('emitToAll', emitToAll);

// // Make io and connectedUsers available to routes
// app.set('io', io);
// app.set('connectedUsers', connectedUsers);

// app.use(helmet());
// app.use(cors({ origin: process.env.FRONTEND_URL || 'https://cbc-it-incident-management.onrender.com', credentials: true })); //http://localhost:5173
// app.set('trust proxy', 1);
// app.use(express.json({ limit: '100mb' })); // ← Added limit

// const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5000 });
// app.use('/api/', limiter);

// app.use('/api/auth', authRoutes);
// app.use('/api/tickets', ticketRoutes);
// app.use('/api/stats', statsRoutes);
// app.use('/api/reports', reportRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/static', staticRoutes);
// app.use('/api/notifications', notificationRoutes);


// app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// poolPromise.then(() => {
//     app.listen(PORT, () => console.log(`🚀 Backend running on http://localhost:${PORT}`));
// }).catch(err => {
//     console.error('Failed to connect to database:', err);
//     process.exit(1);
// });