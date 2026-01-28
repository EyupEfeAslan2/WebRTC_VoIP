/**
 * WebRTC VoIP Server - Room-Based Architecture
 * Oda tabanlı sinyalleşme sunucusu
 * SHA-256 şifreleme ile güvenlik
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// Konfigürasyon
// ============================================================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    MAX_ROOM_SIZE: 10, // Maksimum oda kapasitesi
    HEARTBEAT_INTERVAL: 30000, // 30 saniye
    SALT: 'voip-secret-salt', 
    SALT_ROUNDS: 'voip-secret-salt-2026' // hashPassword fonksiyonunda kullanılıyor
};

// ============================================================================
// Server State - Room Management
// ============================================================================
const ServerState = {
    rooms: new Map(), // roomId -> Set of socketIds
    socketToRoom: new Map(), // socketId -> roomId
    socketToUser: new Map(), // socketId -> userId 
    stats: {
        totalConnections: 0,
        activeConnections: 0,
        totalRooms: 0,
        activeRooms: 0,
        secureRooms: 0,
    }
};

// ============================================================================
// Express Sunucu Kurulumu
// ============================================================================
const app = express();
const server = http.createServer(app);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        stats: ServerState.stats,
        uptime: process.uptime()
    });
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
    const roomsInfo = Array.from(ServerState.rooms.entries()).map(([roomId, room]) => ({
        roomId,
        memberCount: room.members ? room.members.size : 0,
        hasPassword: !!room.passwordHash,
        createdAt: room.createdAt,
        createdBy: room.createdBy
    }));
    
    res.json({
        stats: ServerState.stats,
        rooms: roomsInfo
    });
});

// Room Info Endpoint
app.get('/api/room/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = ServerState.rooms.get(roomId);
    
    if (!room) {
        return res.status(404).json({ error: 'Oda bulunamadı' });
    }
    
    res.json({
        roomId,
        memberCount: room.members.size,
        maxSize: CONFIG.MAX_ROOM_SIZE,
        hasPassword: !!room.passwordHash,
        isFull: room.members.size >= CONFIG.MAX_ROOM_SIZE,
        createdAt: room.createdAt
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// ============================================================================
// Socket.io Kurulumu
// ============================================================================
const io = new Server(server, {
    cors: {
        origin: CONFIG.CORS_ORIGIN,
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Şifre hash'leme (SHA-256)
 */
function hashPassword(password) {
    if (!password) return null;
    return crypto
        .createHash('sha256')
        .update(password + CONFIG.SALT_ROUNDS)
        .digest('hex');
}

/**
 * Şifre doğrulama
 */
function verifyPassword(password, hash) {
    if (!hash) return true; // Oda şifresizse her şifre kabul
    if (!password) return false;
    return hashPassword(password) === hash;
}

/**
 * Oda bilgilerini broadcast et
 */
function broadcastRoomInfo(roomId) {
    const room = ServerState.rooms.get(roomId);
    if (!room) return;
    
    const roomInfo = {
        roomId,
        memberCount: room.members.size,
        maxSize: CONFIG.MAX_ROOM_SIZE,
        members: Array.from(room.members)
    };
    
    io.to(roomId).emit('room-info-update', roomInfo);
}

// ============================================================================
// Socket.io Event Handlers - ANA BAĞLANTI NOKTASI
// ============================================================================

io.on('connection', (socket) => {
    logInfo(`Yeni bağlantı: ${socket.id}`);
    
    ServerState.stats.totalConnections++;
    ServerState.stats.activeConnections++;
    
    // Client'a ID gönder
    socket.emit('connect-success', socket.id);

    // Senin yazdığın karmaşık logic burada patlıyordu. 
    // Aşağıdaki 'registerSocketHandlers' fonksiyonunu kullanarak her şeyi topluyoruz.
    registerSocketHandlers(socket);

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });
});

/**
 * Socket event handler'larını kaydet
 * @param {Socket} socket 
 */
function registerSocketHandlers(socket) {
    // Room yönetimi - Veriyi ayrıştırıp gönderiyoruz
    socket.on('join-room', (data) => {
        // Data obje mi string mi kontrolü
        const roomId = (typeof data === 'object') ? data.roomId : data;
        const password = (typeof data === 'object') ? data.password : null;
        handleJoinRoom(socket, roomId, password);
    });
    
    // WebRTC signaling
    socket.on('offer', (data) => handleOffer(socket, data));
    socket.on('answer', (data) => handleAnswer(socket, data));
    socket.on('candidate', (data) => handleIceCandidate(socket, data));
    
    // Hata yönetimi
    socket.on('error', (error) => handleSocketError(socket, error));
}

// ============================================================================
// Room Management Handlers
// ============================================================================

/**
 * Odaya katılma veya oda oluşturma
 */
function handleJoinRoom(socket, roomId, password) {
    if (!roomId || typeof roomId !== 'string') {
        socket.emit('error', { message: 'Geçersiz oda ID' });
        return;
    }
    
    // Temiz oda ID
    const cleanRoomId = roomId.trim();
    
    // Oda yoksa oluştur
    if (!ServerState.rooms.has(cleanRoomId)) {
        ServerState.rooms.set(cleanRoomId, {
            members: new Set(),
            passwordHash: hashPassword(password),
            createdAt: new Date(),
            createdBy: socket.id
        });
        ServerState.stats.totalRooms++;
        ServerState.stats.activeRooms++;
        if (password) ServerState.stats.secureRooms++;
        logSuccess(`Yeni oda oluşturuldu: ${cleanRoomId}`);
    }
    
    const room = ServerState.rooms.get(cleanRoomId);
    
    // ŞİFRE KONTROLÜ (Senin istediğin kısım buraya entegre edildi)
    if (!verifyPassword(password, room.passwordHash)) {
        socket.emit('wrong-password', { roomId: cleanRoomId });
        logWarning(`Yanlış şifre: ${socket.id} → ${cleanRoomId}`);
        return;
    }
    
    // Oda dolu mu kontrol et
    if (room.members.size >= CONFIG.MAX_ROOM_SIZE) {
        socket.emit('room-full', { roomId: cleanRoomId });
        logWarning(`Oda dolu: ${cleanRoomId} (${room.members.size}/${CONFIG.MAX_ROOM_SIZE})`);
        return;
    }
    
    // Socket'i odaya ekle
    socket.join(cleanRoomId);
    room.members.add(socket.id);
    ServerState.socketToRoom.set(socket.id, cleanRoomId);
    
    // Bildirimler
    socket.to(cleanRoomId).emit('user-connected', socket.id);

    // Odadaki ilk kişi mi?
    if (room.members.size === 1) {
        socket.emit('room-created', { roomId: cleanRoomId, hasPassword: !!room.passwordHash });
        logInfo(`${socket.id} odayı oluşturdu: ${cleanRoomId}`);
    } else {
        socket.emit('room-joined', { 
            roomId: cleanRoomId, 
            memberCount: room.members.size,
            hasPassword: !!room.passwordHash
        });
        logInfo(`${socket.id} odaya katıldı: ${cleanRoomId} (${room.members.size} kişi)`);
    }
    
    broadcastRoomInfo(cleanRoomId);
}

// ============================================================================
// WebRTC Signaling Handlers
// ============================================================================

/**
 * WebRTC Offer işleme
 */
function handleOffer(socket, data) {
    // Veri doğrulama
    if (!data || !data.target || !data.sdp) {
        // Hata bastırmıyoruz, sessizce geçiyoruz
        return;
    }
    
    const { target, sdp } = data;
    // Hedefe ilet
    socket.to(target).emit('offer', sdp, socket.id);
    logInfo(`Offer iletildi: ${socket.id} → ${target}`);
}

/**
 * WebRTC Answer işleme
 */
function handleAnswer(socket, data) {
    if (!data || !data.target || !data.sdp) return;
    
    const { target, sdp } = data;
    // Hedefe ilet
    socket.to(target).emit('answer', sdp, socket.id);
    logSuccess(`Answer iletildi: ${socket.id} → ${target}`);
}

/**
 * ICE Candidate işleme
 */
function handleIceCandidate(socket, data) {
    if (!data || !data.target || !data.candidate) return;
    
    const { target, candidate } = data;
    // Hedefe ilet
    socket.to(target).emit('candidate', candidate, socket.id);
}

/**
 * Bağlantı kopması
 */
function handleDisconnect(socket) {
    const roomId = ServerState.socketToRoom.get(socket.id);
    
    if (roomId) {
        const room = ServerState.rooms.get(roomId);
        
        if (room) {
            // 1. ÖNCE SİL
            room.members.delete(socket.id);
            
            // Ayrılan kişiyi diğerlerine bildir (Client'taki onUserDisconnected tetiklenir)
            socket.to(roomId).emit('user-disconnected', socket.id);
            
            // Oda boşaldıysa sil
            if (room.members.size === 0) {
                ServerState.rooms.delete(roomId);
                ServerState.stats.activeRooms--;
                if (room.passwordHash) ServerState.stats.secureRooms--;
                logInfo(`Oda silindi: ${roomId}`);
            } else {
                // 2. SONRA GÜNCEL SAYIYI DUYUR (Kalan kişi sayısını gönderir)
                broadcastRoomInfo(roomId);
                logWarning(`Kullanıcı ayrıldı: ${socket.id} | Oda: ${roomId} (${room.members.size} kişi kaldı)`);
            }
        }
        
        ServerState.socketToRoom.delete(socket.id);
    }
    
    ServerState.stats.activeConnections--;
}

/**
 * Socket hatası
 */
function handleSocketError(socket, error) {
    logError(`Socket hatası [${socket.id}]: ${error.message}`);
}

// ============================================================================
// Logging Fonksiyonları
// ============================================================================

function logInfo(message) {
    const timestamp = new Date().toISOString();
    console.log(`\x1b[36m[INFO]\x1b[0m [${timestamp}] ${message}`);
}

function logSuccess(message) {
    const timestamp = new Date().toISOString();
    console.log(`\x1b[32m[SUCCESS]\x1b[0m [${timestamp}] ${message}`);
}

function logWarning(message) {
    const timestamp = new Date().toISOString();
    console.warn(`\x1b[33m[WARNING]\x1b[0m [${timestamp}] ${message}`);
}

function logError(message) {
    const timestamp = new Date().toISOString();
    console.error(`\x1b[31m[ERROR]\x1b[0m [${timestamp}] ${message}`);
}

// ============================================================================
// Periyodik İşlemler
// ============================================================================

setInterval(() => {
    logInfo(`Aktif bağlantılar: ${ServerState.stats.activeConnections} | Aktif odalar: ${ServerState.stats.activeRooms}`);
}, CONFIG.HEARTBEAT_INTERVAL);

// ============================================================================
// Sunucu Başlatma
// ============================================================================

server.listen(CONFIG.PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('\x1b[35m%s\x1b[0m', '🎙️  WebRTC VoIP Server - Turkcell');
    console.log('='.repeat(60));
    logSuccess(`Sunucu çalışıyor: http://localhost:${CONFIG.PORT}`);
    logInfo(`Ortam: ${CONFIG.NODE_ENV}`);
    console.log('='.repeat(60) + '\n');
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

function gracefulShutdown(signal) {
    logWarning(`${signal} sinyali alındı. Sunucu kapatılıyor...`);
    io.emit('server-shutdown', { message: 'Sunucu bakıma alınıyor' });
    io.close(() => {
        server.close(() => process.exit(0));
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server, io, ServerState };