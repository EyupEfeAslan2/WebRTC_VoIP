//Signaling Manager
export class SignalingManager {
    constructor() {
        this.socket = null;
        
        this.onConnected = null;
        this.onUserConnected = null;    // Yeni biri geldiğinde
        this.onUserDisconnected = null; // Biri gittiğinde
        this.onRoomCreated = null;      // Oda oluşturuldu
        this.onRoomJoined = null;       // Odaya katılındı
        this.onRoomInfoUpdate = null;   // Oda bilgisi güncellendi
        this.onWrongPassword = null;    // Yanlış şifre
        this.onRoomFull = null;         // Oda dolu

        this.onOffer = null;
        this.onAnswer = null;
        this.onIceCandidate = null;

        this.onError = null;
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
        // Oda oluşturuldu
        this.socket.on('room-created', (data) => {
            console.log('Oda oluşturuldu:', data);
            if (this.onRoomCreated) {
                this.onRoomCreated(data);
            }
        });

        // 4. Odaya katılındı
        this.socket.on('room-joined', (data) => {
            console.log('Odaya katılındı:', data);
            if (this.onRoomJoined) {
                this.onRoomJoined(data);
            }
        });

        // 5. Oda bilgisi güncellendi
        this.socket.on('room-info-update', (data) => {
            if (this.onRoomInfoUpdate) {
                this.onRoomInfoUpdate(data);
            }
        });

        // 6. Yanlış şifre
        this.socket.on('wrong-password', (data) => {
            console.log('Yanlış şifre:', data.roomId);
            if (this.onWrongPassword) {
                this.onWrongPassword(data);
            }
        });

        // 7. Oda dolu
        this.socket.on('room-full', (data) => {
            console.log('Oda dolu:', data);
            if (this.onRoomFull) {
                this.onRoomFull(data);
            }
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
        // Hata
        this.socket.on('error', (error) => {
            console.error('Socket hatası:', error);
            if (this.onError) {
                this.onError(error);
            }
        });

        // Bağlantı koptu
        this.socket.on('disconnect', (reason) => {
            console.log('Bağlantı koptu:', reason);
        });
    }

    /**
     * Odaya gir (şifre ile)
     * @param {string} roomId 
     * @param {string|null} password 
     */

    joinRoom(roomId, password = null) {
        if (!this.socket) {
            console.error('Socket bağlantısı yok');
            return;
        }

        this.socket.emit('join-room', {
            roomId: roomId.trim(),
            password: password ? password.trim() : null
        });
    }

    /**
     * Odadan ayrıl
     * @param {string} roomId 
     */
    leaveRoom(roomId) {
        if (this.socket && roomId) {
            this.socket.emit('leave-room', roomId);
        }
    }

    /**
     * Offer gönder (belirli bir kullanıcıya)
     * @param {RTCSessionDescriptionInit} offer 
     * @param {string} targetUserId 
     */
    sendOffer(offer, targetUserId) {
        if (!this.socket) return;
        
        this.socket.emit('offer', { 
            target: targetUserId, 
            sdp: offer 
        });
    }

    /**
     * Answer gönder (belirli bir kullanıcıya)
     * @param {RTCSessionDescriptionInit} answer 
     * @param {string} targetUserId 
     */
    sendAnswer(answer, targetUserId) {
        if (!this.socket) return;
        
        this.socket.emit('answer', { 
            target: targetUserId, 
            sdp: answer 
        });
    }

    /**
     * ICE Candidate gönder (belirli bir kullanıcıya)
     * @param {RTCIceCandidate} candidate 
     * @param {string} targetUserId 
     */
    sendIceCandidate(candidate, targetUserId) {
        if (!this.socket) return;
        
        this.socket.emit('candidate', { 
            target: targetUserId, 
            candidate: candidate 
        });
    }

    /**
     * Bağlantıyı kapat
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    /**
     * Socket ID'yi al
     */
    getSocketId() {
        return this.socket ? this.socket.id : null;
    }
}