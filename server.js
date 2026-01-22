/**
 * WebRTC VoIP Server - Room-Based Architecture
 * Turkcell VoIP Ekibi - Staj Projesi
 * 
 * Oda tabanlı sinyalleşme sunucusu
 * Clean code ve modüler yapıyla geliştirilmiştir
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ============================================================================
// Konfigürasyon
// ============================================================================
const CONFIG = {
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    MAX_ROOM_SIZE: 10, // Maksimum oda kapasitesi
    HEARTBEAT_INTERVAL: 30000 // 30 saniye
};

// ============================================================================
// Server State - Room Management
// ============================================================================
const ServerState = {
    rooms: new Map(), // roomId -> Set of socketIds
    socketToRoom: new Map(), // socketId -> roomId
    stats: {
        totalConnections: 0,
        activeConnections: 0,
        totalRooms: 0,
        activeRooms: 0
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
    const roomsInfo = Array.from(ServerState.rooms.entries()).map(([roomId, members]) => ({
        roomId,
        memberCount: members.size,
        members: Array.from(members)
    }));
    
    res.json({
        stats: ServerState.stats,
        rooms: roomsInfo
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
// Socket.io Event Handlers
// ============================================================================

/**
 * Yeni bağlantı kurulduğunda
 */
io.on('connection', (socket) => {
    logInfo(`Yeni bağlantı: ${socket.id}`);
    
    ServerState.stats.totalConnections++;
    ServerState.stats.activeConnections++;
    
    // Event handler'ları kaydet
    registerSocketHandlers(socket);
    
    // Bağlantı koptuğunda
    socket.on('disconnect', () => handleDisconnect(socket));
});

/**
 * Socket event handler'larını kaydet
 * @param {Socket} socket 
 */
function registerSocketHandlers(socket) {
    // Room yönetimi
    socket.on('join-room', (roomId) => handleJoinRoom(socket, roomId));
    
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
function handleJoinRoom(socket, roomId) {
    if (!roomId || typeof roomId !== 'string') {
        socket.emit('error', { message: 'Geçersiz oda ID' });
        return;
    }
    
    // Temiz oda ID
    const cleanRoomId = roomId.trim();
    
    // Oda yoksa oluştur
    if (!ServerState.rooms.has(cleanRoomId)) {
        ServerState.rooms.set(cleanRoomId, new Set());
        ServerState.stats.totalRooms++;
        ServerState.stats.activeRooms++;
        logSuccess(`Yeni oda oluşturuldu: ${cleanRoomId}`);
    }
    
    const room = ServerState.rooms.get(cleanRoomId);
    
    // Oda dolu mu kontrol et
    if (room.size >= CONFIG.MAX_ROOM_SIZE) {
        socket.emit('full-room');
        logWarning(`Oda dolu: ${cleanRoomId} (${room.size}/${CONFIG.MAX_ROOM_SIZE})`);
        return;
    }
    
    // Socket'i odaya ekle
    socket.join(cleanRoomId);
    room.add(socket.id);
    ServerState.socketToRoom.set(socket.id, cleanRoomId);
    
    // Odadaki ilk kişi mi?
    if (room.size === 1) {
        socket.emit('room-created');
        logInfo(`${socket.id} odayı oluşturdu: ${cleanRoomId}`);
    } else {
        socket.emit('room-joined');
        logInfo(`${socket.id} odaya katıldı: ${cleanRoomId} (${room.size} kişi)`);
        
        // Diğer katılımcılara bildir
        socket.to(cleanRoomId).emit('ready');
        socket.emit('ready');
        
        logSuccess(`Oda hazır: ${cleanRoomId} (${room.size} kişi)`);
    }
}

// ============================================================================
// WebRTC Signaling Handlers
// ============================================================================

/**
 * WebRTC Offer işleme
 */
function handleOffer(socket, data) {
    const { sdp, roomId } = data;
    
    if (!validateSignalingData(data, ['sdp', 'roomId'])) {
        socket.emit('error', { message: 'Geçersiz offer verisi' });
        return;
    }
    
    // Odaya gönder (kendisi hariç)
    socket.to(roomId).emit('offer', { sdp });
    
    logInfo(`Offer iletildi: ${socket.id} → Oda: ${roomId}`);
}

/**
 * WebRTC Answer işleme
 */
function handleAnswer(socket, data) {
    const { sdp, roomId } = data;
    
    if (!validateSignalingData(data, ['sdp', 'roomId'])) {
        socket.emit('error', { message: 'Geçersiz answer verisi' });
        return;
    }
    
    // Odaya gönder (kendisi hariç)
    socket.to(roomId).emit('answer', { sdp });
    
    logSuccess(`Answer iletildi: ${socket.id} → Oda: ${roomId}`);
}

/**
 * ICE Candidate işleme
 */
function handleIceCandidate(socket, data) {
    const { candidate, roomId } = data;
    
    if (!validateSignalingData(data, ['candidate', 'roomId'])) {
        socket.emit('error', { message: 'Geçersiz ICE candidate verisi' });
        return;
    }
    
    // Odaya gönder (kendisi hariç)
    socket.to(roomId).emit('candidate', { candidate });
    
    logInfo(`ICE candidate iletildi: ${socket.id} → Oda: ${roomId}`);
}

/**
 * Bağlantı kopması
 */
function handleDisconnect(socket) {
    const roomId = ServerState.socketToRoom.get(socket.id);
    
    if (roomId) {
        const room = ServerState.rooms.get(roomId);
        
        if (room) {
            // Kullanıcıyı odadan çıkar
            room.delete(socket.id);
            
            // Oda boşaldıysa sil
            if (room.size === 0) {
                ServerState.rooms.delete(roomId);
                ServerState.stats.activeRooms--;
                logInfo(`Oda silindi: ${roomId}`);
            } else {
                logWarning(`Kullanıcı ayrıldı: ${socket.id} | Oda: ${roomId} (${room.size} kişi kaldı)`);
            }
        }
        
        ServerState.socketToRoom.delete(socket.id);
    }
    
    ServerState.stats.activeConnections--;
    logWarning(`Bağlantı koptu: ${socket.id}`);
}

/**
 * Socket hatası
 */
function handleSocketError(socket, error) {
    logError(`Socket hatası [${socket.id}]: ${error.message}`);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Signaling verisi validasyonu
 */
function validateSignalingData(data, requiredFields) {
    return requiredFields.every(field => 
        data.hasOwnProperty(field) && data[field] != null
    );
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

/**
 * Heartbeat - Bağlantı durumunu kontrol et
 */
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
    logInfo(`Max bağlantı: ${CONFIG.MAX_CONNECTIONS}`);
    console.log('='.repeat(60) + '\n');
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

function gracefulShutdown(signal) {
    logWarning(`${signal} sinyali alındı. Sunucu kapatılıyor...`);
    
    // Tüm kullanıcılara bildir
    io.emit('server-shutdown', { message: 'Sunucu bakıma alınıyor' });
    
    // Bağlantıları kapat
    io.close(() => {
        logSuccess('Socket.io bağlantıları kapatıldı');
        
        server.close(() => {
            logSuccess('HTTP sunucusu kapatıldı');
            process.exit(0);
        });
    });
    
    // Timeout ile zorla kapat
    setTimeout(() => {
        logError('Graceful shutdown timeout. Zorla kapatılıyor...');
        process.exit(1);
    }, 10000);
}

// Signal handler'ları
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logError(`Uncaught Exception: ${error.message}`);
    logError(error.stack);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logError(`Unhandled Rejection at: ${promise}`);
    logError(`Reason: ${reason}`);
});

// ============================================================================
// Export (Testing için)
// ============================================================================
module.exports = { app, server, io, ServerState };