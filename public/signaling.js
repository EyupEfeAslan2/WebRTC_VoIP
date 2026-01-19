/**
 * SignalingManager - Socket.io üzerinden sinyalleşme yönetimi
 * WebRTC peer bağlantıları için signaling protokolü
 */

export class SignalingManager {
    constructor(serverUrl = window.location.origin) {
        this.socket = null;
        this.serverUrl = serverUrl;
        this.userId = null;
        this.isConnected = false;
        
        // Event callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onUserJoined = null;
        this.onUserLeft = null;
        this.onOffer = null;
        this.onAnswer = null;
        this.onIceCandidate = null;
        this.onError = null;
    }

    /**
     * Socket.io bağlantısını başlat
     */
    connect(userId = null) {
        return new Promise((resolve, reject) => {
            try {
                // Socket.io bağlantısı
                this.socket = io(this.serverUrl, {
                    reconnection: true,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    reconnectionAttempts: 5
                });

                // Bağlantı başarılı
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.userId = userId || this.socket.id;
                    
                    // Sunucuya kullanıcı kaydı
                    this.socket.emit('register', { userId: this.userId });
                    
                    if (this.onConnected) {
                        this.onConnected(this.userId);
                    }
                    
                    resolve(this.userId);
                });

                // Bağlantı koptu
                this.socket.on('disconnect', (reason) => {
                    this.isConnected = false;
                    
                    if (this.onDisconnected) {
                        this.onDisconnected(reason);
                    }
                });

                // Bağlantı hatası
                this.socket.on('connect_error', (error) => {
                    if (this.onError) {
                        this.onError(error);
                    }
                    reject(error);
                });

                // WebRTC signaling event'leri
                this._setupSignalingHandlers();
                
            } catch (error) {
                if (this.onError) {
                    this.onError(error);
                }
                reject(error);
            }
        });
    }

    /**
     * WebRTC signaling event handler'larını kur
     * @private
     */
    _setupSignalingHandlers() {
        // Yeni kullanıcı katıldı
        this.socket.on('user-joined', (data) => {
            if (this.onUserJoined) {
                this.onUserJoined(data);
            }
        });

        // Kullanıcı ayrıldı
        this.socket.on('user-left', (data) => {
            if (this.onUserLeft) {
                this.onUserLeft(data);
            }
        });

        // WebRTC Offer alındı
        this.socket.on('offer', (data) => {
            if (this.onOffer) {
                this.onOffer(data);
            }
        });

        // WebRTC Answer alındı
        this.socket.on('answer', (data) => {
            if (this.onAnswer) {
                this.onAnswer(data);
            }
        });

        // ICE Candidate alındı
        this.socket.on('ice-candidate', (data) => {
            if (this.onIceCandidate) {
                this.onIceCandidate(data);
            }
        });
    }

    /**
     * WebRTC Offer gönder
     */
    sendOffer(targetUserId, offer) {
        if (!this.isConnected) {
            throw new Error('Socket bağlantısı yok');
        }

        this.socket.emit('offer', {
            from: this.userId,
            to: targetUserId,
            offer: offer
        });
    }

    /**
     * WebRTC Answer gönder
     */
    sendAnswer(targetUserId, answer) {
        if (!this.isConnected) {
            throw new Error('Socket bağlantısı yok');
        }

        this.socket.emit('answer', {
            from: this.userId,
            to: targetUserId,
            answer: answer
        });
    }

    /**
     * ICE Candidate gönder
     */
    sendIceCandidate(targetUserId, candidate) {
        if (!this.isConnected) {
            throw new Error('Socket bağlantısı yok');
        }

        this.socket.emit('ice-candidate', {
            from: this.userId,
            to: targetUserId,
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
            this.isConnected = false;
        }
    }

    /**
     * Bağlantı durumunu kontrol et
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            userId: this.userId,
            socketId: this.socket ? this.socket.id : null
        };
    }
}