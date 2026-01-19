/**
 * WebRTC VoIP Server
 * Turkcell VoIP Ekibi - Staj Projesi
 * 
 * Bu sunucu WebRTC signaling için Socket.io kullanır
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
    MAX_CONNECTIONS: 100,
    HEARTBEAT_INTERVAL: 30000 // 30 saniye
};

// ============================================================================
// Uygulama Durumu (State Management)
// ============================================================================
const ServerState = {
    connectedUsers: new Map(), // socketId -> userData
    activeCalls: new Map(),    // callId -> {caller, callee, startTime}
    stats: {
        totalConnections: 0,
        activeConnections: 0,
        totalCalls: 0,
        activeCalls: 0
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
    res.json({
        stats: ServerState.stats,
        users: Array.from(ServerState.connectedUsers.values()).map(u => ({
            userId: u.userId,
            connectedAt: u.connectedAt
        })),
        calls: Array.from(ServerState.activeCalls.values())
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
    socket.on('register', (data) => handleUserRegister(socket, data));
    socket.on('offer', (data) => handleOffer(socket, data));
    socket.on('answer', (data) => handleAnswer(socket, data));
    socket.on('ice-candidate', (data) => handleIceCandidate(socket, data));
    socket.on('hangup', (data) => handleHangup(socket, data));
    socket.on('error', (error) => handleSocketError(socket, error));
}

// ============================================================================
// Signaling Event Handlers
// ============================================================================

/**
 * Kullanıcı kaydı
 */
function handleUserRegister(socket, data) {
    const userId = data.userId || socket.id;
    
    const userData = {
        socketId: socket.id,
        userId: userId,
        connectedAt: new Date().toISOString(),
        isInCall: false
    };
    
    ServerState.connectedUsers.set(socket.id, userData);
    
    // Kullanıcıya ID'sini gönder
    socket.emit('registered', { userId });
    
    // Diğer kullanıcılara bildir
    socket.broadcast.emit('user-joined', { userId });
    
    logSuccess(`Kullanıcı kaydedildi: ${userId}`);
}

/**
 * WebRTC Offer işleme
 */
function handleOffer(socket, data) {
    const { from, to, offer } = data;
    
    if (!validateSignalingData(data, ['from', 'to', 'offer'])) {
        socket.emit('error', { message: 'Geçersiz offer verisi' });
        return;
    }
    
    // Hedef kullanıcıyı bul
    const targetSocket = findSocketByUserId(to);
    
    if (!targetSocket) {
        socket.emit('error', { message: 'Hedef kullanıcı bulunamadı' });
        logWarning(`Offer iletimi başarısız: ${to} kullanıcısı bulunamadı`);
        return;
    }
    
    // Offer'ı ilet
    targetSocket.emit('offer', { from, offer });
    
    // Arama kaydı oluştur
    const callId = `${from}_${to}_${Date.now()}`;
    ServerState.activeCalls.set(callId, {
        caller: from,
        callee: to,
        startTime: new Date().toISOString(),
        status: 'ringing'
    });
    
    ServerState.stats.totalCalls++;
    ServerState.stats.activeCalls++;
    
    logInfo(`Offer iletildi: ${from} → ${to}`);
}

/**
 * WebRTC Answer işleme
 */
function handleAnswer(socket, data) {
    const { from, to, answer } = data;
    
    if (!validateSignalingData(data, ['from', 'to', 'answer'])) {
        socket.emit('error', { message: 'Geçersiz answer verisi' });
        return;
    }
    
    // Hedef kullanıcıyı bul
    const targetSocket = findSocketByUserId(to);
    
    if (!targetSocket) {
        socket.emit('error', { message: 'Hedef kullanıcı bulunamadı' });
        logWarning(`Answer iletimi başarısız: ${to} kullanıcısı bulunamadı`);
        return;
    }
    
    // Answer'ı ilet
    targetSocket.emit('answer', { from, answer });
    
    // Arama durumunu güncelle
    updateCallStatus(from, to, 'connected');
    
    logSuccess(`Answer iletildi: ${from} → ${to}`);
}

/**
 * ICE Candidate işleme
 */
function handleIceCandidate(socket, data) {
    const { from, to, candidate } = data;
    
    if (!validateSignalingData(data, ['from', 'to', 'candidate'])) {
        socket.emit('error', { message: 'Geçersiz ICE candidate verisi' });
        return;
    }
    
    // Hedef kullanıcıyı bul
    const targetSocket = findSocketByUserId(to);
    
    if (!targetSocket) {
        logWarning(`ICE candidate iletimi başarısız: ${to} kullanıcısı bulunamadı`);
        return;
    }
    
    // ICE candidate'i ilet
    targetSocket.emit('ice-candidate', { from, candidate });
    
    logInfo(`ICE candidate iletildi: ${from} → ${to}`);
}

/**
 * Arama sonlandırma
 */
function handleHangup(socket, data) {
    const { from, to } = data;
    
    // Hedef kullanıcıya bildir
    const targetSocket = findSocketByUserId(to);
    if (targetSocket) {
        targetSocket.emit('hangup', { from });
    }
    
    // Arama kaydını sil
    removeCall(from, to);
    
    logInfo(`Arama sonlandırıldı: ${from} ↔ ${to}`);
}

/**
 * Bağlantı kopması
 */
function handleDisconnect(socket) {
    const userData = ServerState.connectedUsers.get(socket.id);
    
    if (userData) {
        // Kullanıcının aktif aramalarını sonlandır
        terminateUserCalls(userData.userId);
        
        // Kullanıcıyı sil
        ServerState.connectedUsers.delete(socket.id);
        
        // Diğer kullanıcılara bildir
        socket.broadcast.emit('user-left', { userId: userData.userId });
        
        logWarning(`Kullanıcı ayrıldı: ${userData.userId}`);
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
// Yardımcı Fonksiyonlar
// ============================================================================

/**
 * User ID'ye göre socket bul
 */
function findSocketByUserId(userId) {
    for (const [socketId, userData] of ServerState.connectedUsers.entries()) {
        if (userData.userId === userId) {
            return io.sockets.sockets.get(socketId);
        }
    }
    return null;
}

/**
 * Signaling verisi validasyonu
 */
function validateSignalingData(data, requiredFields) {
    return requiredFields.every(field => data.hasOwnProperty(field) && data[field] != null);
}

/**
 * Arama durumunu güncelle
 */
function updateCallStatus(from, to, status) {
    for (const [callId, call] of ServerState.activeCalls.entries()) {
        if ((call.caller === from && call.callee === to) || 
            (call.caller === to && call.callee === from)) {
            call.status = status;
            if (status === 'connected') {
                call.connectedAt = new Date().toISOString();
            }
            break;
        }
    }
}

/**
 * Arama kaydını sil
 */
function removeCall(from, to) {
    for (const [callId, call] of ServerState.activeCalls.entries()) {
        if ((call.caller === from && call.callee === to) || 
            (call.caller === to && call.callee === from)) {
            ServerState.activeCalls.delete(callId);
            ServerState.stats.activeCalls--;
            break;
        }
    }
}

/**
 * Kullanıcının tüm aramalarını sonlandır
 */
function terminateUserCalls(userId) {
    const callsToRemove = [];
    
    for (const [callId, call] of ServerState.activeCalls.entries()) {
        if (call.caller === userId || call.callee === userId) {
            callsToRemove.push(callId);
            
            // Diğer tarafa bildir
            const otherUserId = call.caller === userId ? call.callee : call.caller;
            const otherSocket = findSocketByUserId(otherUserId);
            
            if (otherSocket) {
                otherSocket.emit('hangup', { from: userId });
            }
        }
    }
    
    // Aramaları sil
    callsToRemove.forEach(callId => {
        ServerState.activeCalls.delete(callId);
        ServerState.stats.activeCalls--;
    });
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
    logInfo(`Aktif bağlantılar: ${ServerState.stats.activeConnections} | Aktif aramalar: ${ServerState.stats.activeCalls}`);
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