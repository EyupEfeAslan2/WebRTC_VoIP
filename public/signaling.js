export class SignalingManager {
    constructor() {
        this.socket = null;
        this.onConnected = null;
        this.onUserConnected = null;    // Yeni biri geldiğinde
        this.onUserDisconnected = null; // Biri gittiğinde
        this.onOffer = null;
        this.onAnswer = null;
        this.onIceCandidate = null;
    }

    connect() {
        this.socket = io();

        // 1. Sunucuya Bağlandık
        this.socket.on('connect', () => {
            console.log('Socket bağlandı:', this.socket.id);
            if (this.onConnected) this.onConnected(this.socket.id);
        });

        // 2. Odaya Biri Girdi (Biz içerideyiz, o yeni geldi)
        this.socket.on('user-connected', (userId) => {
            if (this.onUserConnected) this.onUserConnected(userId);
        });

        // 3. Biri Ayrıldı
        this.socket.on('user-disconnected', (userId) => {
            if (this.onUserDisconnected) this.onUserDisconnected(userId);
        });

        // --- Sinyalleşme Mesajları ---
        
        // Offer Geldi
        this.socket.on('offer', (sdp, fromId) => {
            if (this.onOffer) this.onOffer(sdp, fromId);
        });

        // Answer Geldi
        this.socket.on('answer', (sdp, fromId) => {
            if (this.onAnswer) this.onAnswer(sdp, fromId);
        });

        // ICE Candidate Geldi
        this.socket.on('candidate', (candidate, fromId) => {
            if (this.onIceCandidate) this.onIceCandidate(candidate, fromId);
        });
    }

    // Odaya Gir
    joinRoom(roomId) {
        this.socket.emit('join-room', roomId);
    }

    // Odadan Çık
    leaveRoom(roomId) {
        this.socket.emit('leave-room', roomId);
    }

    // --- Hedef Odaklı Mesajlaşma (Relay) ---
    
    sendOffer(offer, targetUserId) {
        this.socket.emit('offer', { target: targetUserId, sdp: offer });
    }

    sendAnswer(answer, targetUserId) {
        this.socket.emit('answer', { target: targetUserId, sdp: answer });
    }

    sendIceCandidate(candidate, targetUserId) {
        this.socket.emit('candidate', { target: targetUserId, candidate: candidate });
    }
}