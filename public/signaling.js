/**
 * SignalingManager - Socket.io Room-Based Signaling
 * WebRTC VoIP Prototype - Clean & Cache-Friendly
 * 
 * Oda tabanlı (room-based) sinyalleşme yönetimi
 * Birden fazla kullanıcının aynı odada iletişim kurmasını sağlar
 */

export class SignalingManager {
    constructor(serverUrl = window.location.origin) {
        // Socket instance
        this.socket = null;
        this.serverUrl = serverUrl;
        
        // Room state
        this.currentRoomId = null;
        this.isConnected = false;
        this.clientId = null;
        
        // Event callbacks - Room events
        this.onConnected = null;
        this.onDisconnected = null;
        this.onRoomCreated = null;
        this.onRoomJoined = null;
        this.onReady = null;
        this.onFull = null;
        
        // Event callbacks - WebRTC signaling
        this.onOffer = null;
        this.onAnswer = null;
        this.onIceCandidate = null;
        
        // Event callbacks - Error handling
        this.onError = null;
    }

    /**
     * Socket.io bağlantısını başlat
     * @returns {Promise<string>} Client ID
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                // Socket.io instance oluştur
                this.socket = io(this.serverUrl, {
                    reconnection: true,
                    reconnectionDelay: 1000,
                    reconnectionDelayMax: 5000,
                    reconnectionAttempts: 5,
                    transports: ['websocket', 'polling']
                });

                // Bağlantı kuruldu
                this.socket.on('connect', () => {
                    this.isConnected = true;
                    this.clientId = this.socket.id;
                    
                    if (this.onConnected) {
                        this.onConnected(this.clientId);
                    }
                    
                    resolve(this.clientId);
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
                    this._handleError('Bağlantı hatası', error);
                    reject(error);
                });

                // Room ve signaling event'lerini dinle
                this._setupRoomHandlers();
                this._setupSignalingHandlers();
                
            } catch (error) {
                this._handleError('Socket başlatma hatası', error);
                reject(error);
            }
        });
    }

    /**
     * Room event handler'larını kur
     * @private
     */
    _setupRoomHandlers() {
        // Oda oluşturuldu (biz ilk kişiyiz)
        this.socket.on('room-created', () => {
            if (this.onRoomCreated) {
                this.onRoomCreated();
            }
        });

        // Odaya katıldık (oda zaten vardı)
        this.socket.on('room-joined', () => {
            if (this.onRoomJoined) {
                this.onRoomJoined();
            }
        });

        // Oda hazır (tüm taraflar odada, WebRTC başlayabilir)
        this.socket.on('ready', () => {
            if (this.onReady) {
                this.onReady();
            }
        });

        // Oda dolu (maksimum kapasite)
        this.socket.on('full-room', () => {
            if (this.onFull) {
                this.onFull();
            }
        });
    }

    /**
     * WebRTC signaling event handler'larını kur
     * @private
     */
    _setupSignalingHandlers() {
        // WebRTC Offer alındı
        this.socket.on('offer', (data) => {
            if (this.onOffer) {
                this.onOffer(data.sdp || data);
            }
        });

        // WebRTC Answer alındı
        this.socket.on('answer', (data) => {
            if (this.onAnswer) {
                this.onAnswer(data.sdp || data);
            }
        });

        // ICE Candidate alındı
        this.socket.on('candidate', (data) => {
            if (this.onIceCandidate) {
                const candidate = data.candidate || data;
                this.onIceCandidate(candidate);
            }
        });
    }

    /**
     * Odaya katıl veya oda oluştur
     * @param {string} roomId - Oda ID/ismi
     */
    joinRoom(roomId) {
        if (!this.isConnected) {
            this._handleError('Odaya giriş hatası', new Error('Socket bağlantısı yok'));
            return;
        }

        if (!roomId || roomId.trim() === '') {
            this._handleError('Odaya giriş hatası', new Error('Geçersiz oda ID'));
            return;
        }

        this.currentRoomId = roomId.trim();
        this.socket.emit('join-room', this.currentRoomId);
    }

    /**
     * WebRTC Offer gönder
     * @param {RTCSessionDescriptionInit} offer 
     */
    sendOffer(offer) {
        if (!this._validateConnection()) return;

        this.socket.emit('offer', {
            sdp: offer,
            roomId: this.currentRoomId
        });
    }

    /**
     * WebRTC Answer gönder
     * @param {RTCSessionDescriptionInit} answer 
     */
    sendAnswer(answer) {
        if (!this._validateConnection()) return;

        this.socket.emit('answer', {
            sdp: answer,
            roomId: this.currentRoomId
        });
    }

    /**
     * ICE Candidate gönder
     * @param {RTCIceCandidate} candidate 
     */
    sendIceCandidate(candidate) {
        if (!this._validateConnection()) return;

        this.socket.emit('candidate', {
            candidate: candidate,
            roomId: this.currentRoomId
        });
    }

    /**
     * Mevcut oda ID'sini ayarla
     * @param {string} roomId 
     */
    setCurrentRoomId(roomId) {
        this.currentRoomId = roomId ? roomId.trim() : null;
    }

    /**
     * Bağlantıyı kapat
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.currentRoomId = null;
            this.clientId = null;
        }
    }

    /**
     * Bağlantı durumunu kontrol et (validation)
     * @private
     * @returns {boolean}
     */
    _validateConnection() {
        if (!this.isConnected || !this.socket) {
            this._handleError('İletişim hatası', new Error('Socket bağlantısı yok'));
            return false;
        }

        if (!this.currentRoomId) {
            this._handleError('İletişim hatası', new Error('Oda ID belirtilmemiş'));
            return false;
        }

        return true;
    }

    /**
     * Hata yönetimi
     * @private
     */
    _handleError(context, error) {
        const errorMessage = `${context}: ${error.message}`;
        console.error(errorMessage, error);
        
        if (this.onError) {
            this.onError(error, context);
        }
    }

    /**
     * Durum bilgisi al
     * @returns {Object}
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            clientId: this.clientId,
            currentRoomId: this.currentRoomId,
            socketId: this.socket ? this.socket.id : null
        };
    }
}