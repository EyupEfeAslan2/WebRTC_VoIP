/**
 * Main Application Script
 */

import { AudioManager } from './audio-manager.js';
import { SignalingManager } from './signaling.js';

// Application State Management
const AppState = {
    audioManager: null,
    signalingManager: null,
    peerConnection: null,
    
    // Room state
    isInCall: false,
    currentRoomId: null,
    isInitiator: false, // Odayı kuran taraf mı?
    
    // ICE sunucuları (STUN)
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// DOM Elements Cache- Belge nesneleri önbelleği
const DOM = {
    userId: null,
    roomId: null,
    initAudioBtn: null,
    muteBtn: null,
    callBtn: null,
    hangupBtn: null,
    statusDot: null,
    statusText: null,
    logOutput: null,
    audioCanvas: null,
    remoteAudio: null
};

// Application Initialization

document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    initializeManagers();
    attachEventListeners();
    log('Sistem hazır. Mikrofonu başlatın.', 'info');
});

/**
 * DOM elementlerini cache'e al
 */
function cacheDOMElements() {
    DOM.userId = document.getElementById('userId');
    DOM.roomId = document.getElementById('peerId');
    DOM.initAudioBtn = document.getElementById('initAudioBtn');
    DOM.muteBtn = document.getElementById('muteBtn');
    DOM.callBtn = document.getElementById('callBtn');
    DOM.hangupBtn = document.getElementById('hangupBtn');
    DOM.statusDot = document.querySelector('.status-dot');
    DOM.statusText = document.querySelector('.status-text');
    DOM.logOutput = document.getElementById('logOutput');
    DOM.audioCanvas = document.getElementById('audioCanvas');
    DOM.remoteAudio = document.getElementById('remoteAudio');
}
/**
 * Manager sınıflarını başlat
 */
function initializeManagers() {
    // Audio Manager
    AppState.audioManager = new AudioManager();
    AppState.audioManager.onError = (error) => {
        log(`Audio hatası: ${error.message}`, 'error');
    };
    
    // Signaling Manager
    AppState.signalingManager = new SignalingManager();
    // YENİ: Partner ayrıldığında yapılacaklar
    AppState.signalingManager.onPeerLeft = (userId) => {
        log(`Partner (${userId}) odadan ayrıldı.`, 'warning');
        
        // Sadece P2P bağlantısını kapat, ama odayı kapatma!
        closePeerConnection();
        
        // Durumu güncelle: Hala odadayız ama yalnızız
        // isInitiator durumunu koruyabiliriz veya true yapabiliriz
        // çünkü artık odadaki tek kişi biziz (Lider olduk)
        AppState.isInitiator = true; 
        AppState.isInCall = false; // Aktif görüşme bitti
        
        // UI Güncellemesi (Tekrar beklemeye geçiyoruz)
        updateUICallState(false); // Butonları aktif et (İstersek çıkabiliriz)
        DOM.callBtn.disabled = true; // Ama zaten odadayız, tekrar giremeyiz
        DOM.hangupBtn.disabled = false; // İstersek çıkabiliriz
        
        log('Odada tek kaldınız. Yeni katılımcı bekleniyor...', 'info');
    };
    
    // Connection events
    AppState.signalingManager.onConnected = (clientId) => {
        log(`Sunucuya bağlandı. Client ID: ${clientId}`, 'success');
        DOM.statusDot.classList.add('connected');
        DOM.statusText.textContent = 'Sunucuya Bağlı';
        DOM.userId.value = clientId;
    };
    
    AppState.signalingManager.onDisconnected = (reason) => {
        log(`Bağlantı koptu: ${reason}`, 'warning');
        DOM.statusDot.classList.remove('connected');
        DOM.statusText.textContent = 'Bağlantı Koptu';
    };
    
    // Room events
    AppState.signalingManager.onRoomCreated = () => {
        log('Oda oluşturuldu. Diğer kullanıcılar bekleniyor...', 'info');
        AppState.isInitiator = true;
    };
    
    AppState.signalingManager.onRoomJoined = () => {
        log('Odaya katılındı. Bağlantı kuruluyor...', 'info');
        AppState.isInitiator = false;
    };
    
    AppState.signalingManager.onReady = async () => {
        // Eğer kurucu bizsek, offer'ı biz başlatırız
        if (AppState.isInitiator) {
            await initiateWebRTC();
        }
    };
    
    AppState.signalingManager.onFull = () => {
        log('HATA: Oda dolu! Başka bir oda ismi deneyin.', 'error');
        resetCallState();
    };
    
    // WebRTC signaling events
    AppState.signalingManager.onOffer = async (sdp) => {
        if (!AppState.isInitiator && !AppState.isInCall) {
            await handleIncomingOffer(sdp);
        }
    };
    
    AppState.signalingManager.onAnswer = async (sdp) => {
        if (AppState.peerConnection) {
            await AppState.peerConnection.setRemoteDescription(
                new RTCSessionDescription(sdp)
            );
        }
    };
    
    AppState.signalingManager.onIceCandidate = async (candidate) => {
        if (AppState.peerConnection && candidate) {
            try {
                await AppState.peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );
            } catch (error) {
            }
        }
    };
    
    AppState.signalingManager.onError = (error, context) => {
    };
    
    // Bağlantıyı başlat
    AppState.signalingManager.connect();
}

/**
 * UI event listener'larını bağla
 */
function attachEventListeners() {
    // Mikrofon başlatma
    DOM.initAudioBtn.addEventListener('click', handleInitAudio);
    
    // Mute toggle
    DOM.muteBtn.addEventListener('click', handleMuteToggle);
    
    // Odaya gir
    DOM.callBtn.addEventListener('click', handleJoinRoom);
    
    // Aramayı sonlandır
    DOM.hangupBtn.addEventListener('click', handleHangup);
    
    // Enter tuşu ile odaya gir
    DOM.roomId.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !DOM.callBtn.disabled) {
            handleJoinRoom();
        }
    });
}


// Event Handlers - Audio


/**
 * Mikrofon başlatma
 */
async function handleInitAudio() {
    DOM.initAudioBtn.disabled = true;
    
    const result = await AppState.audioManager.initializeMicrophone();
    
    if (result.success) {
        log('Mikrofon başlatıldı', 'success');
        
        // Görselleştirmeyi başlat
        AppState.audioManager.setupVisualization(DOM.audioCanvas);
        
        // UI güncellemeleri
        DOM.initAudioBtn.innerHTML = '<span class="icon"></span> Mikrofon Aktif';
        DOM.muteBtn.disabled = false;
        DOM.callBtn.disabled = false;
        
    } else {
        log(`Mikrofon hatası: ${result.error}`, 'error');
        DOM.initAudioBtn.disabled = false;
        DOM.initAudioBtn.innerHTML = '<span class="icon"></span> Sistemi Başlat';
    }
}

/**
 * Mikrofon sessize alma
 */
function handleMuteToggle() {
    const isMuted = AppState.audioManager.toggleMute();
    
    if (isMuted) {
        DOM.muteBtn.innerHTML = '<span class="icon"></span> Sesi Aç';
        DOM.muteBtn.classList.add('btn-danger');
        DOM.muteBtn.classList.remove('btn-secondary');
        log('Mikrofon sessize alındı', 'info');
    } else {
        DOM.muteBtn.innerHTML = '<span class="icon"></span> Sessize Al';
        DOM.muteBtn.classList.remove('btn-danger');
        DOM.muteBtn.classList.add('btn-secondary');
        log('Mikrofon aktif', 'success');
    }
}


// Event Handlers - Room Management


/**
 * Odaya katılma
 */
function handleJoinRoom() {
    const roomId = DOM.roomId.value.trim();
    
    if (!roomId) {
        log('Lütfen bir oda ismi girin', 'warning');
        return;
    }
    
    if (!AppState.audioManager.localStream) {
        log('Önce mikrofonu başlatın', 'warning');
        return;
    }
    
    AppState.currentRoomId = roomId;
    AppState.signalingManager.setCurrentRoomId(roomId);
    AppState.signalingManager.joinRoom(roomId);
    
    // UI güncelle
    DOM.callBtn.disabled = true;
    DOM.hangupBtn.disabled = false;
    DOM.roomId.disabled = true;
}

/**
 * Aramayı sonlandır
 */
f// handleHangup fonksiyonunu tamamen bununla değiştir:
function handleHangup() {
    log('Aramadan ayrılınıyor...', 'info');

    // 1. Sunucuya haber ver (Ben çıkıyorum)
    if (AppState.currentRoomId) {
        AppState.signalingManager.leaveRoom(AppState.currentRoomId);
    }

    // 2. WebRTC Bağlantısını Temizle
    closePeerConnection();

    // 3. UI'ı Sıfırla (Ama sayfayı yenileme!)
    resetCallState();
    
    log('Aramadan ayrıldınız. Oda hala aktif olabilir.', 'warning');
}

// Yardımcı Fonksiyon: Sadece P2P bağlantısını koparır
function closePeerConnection() {
    if (AppState.peerConnection) {
        // Event listenerları temizle ki hafıza şişmesin
        AppState.peerConnection.onicecandidate = null;
        AppState.peerConnection.ontrack = null;
        AppState.peerConnection.close();
        AppState.peerConnection = null;
        log('P2P Bağlantısı kapatıldı.', 'info');
    }

    // Remote Audio elementini temizle
    if (DOM.remoteAudio.srcObject) {
        DOM.remoteAudio.srcObject.getTracks().forEach(track => track.stop());
        DOM.remoteAudio.srcObject = null;
    }
}

/**
 * Arama durumunu sıfırla
 */
function resetCallState() {
    AppState.isInCall = false;
    AppState.currentRoomId = null;
    AppState.isInitiator = false;
    
    DOM.callBtn.disabled = false;
    DOM.hangupBtn.disabled = true;
    DOM.roomId.disabled = false;
}


// WebRTC Core Logic - Room-Based P2P


/**
 * PeerConnection oluştur (ortak fonksiyon)
 */
function createPeerConnection() {
    log('PeerConnection oluşturuluyor...', 'info');
    
    const pc = new RTCPeerConnection({
        iceServers: AppState.iceServers
    });
    
    // ICE candidate handler
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            AppState.signalingManager.sendIceCandidate(event.candidate);
        }
    };
    
    // Remote stream handler
    pc.ontrack = (event) => {
        if (DOM.remoteAudio.srcObject !== event.streams[0]) {
            DOM.remoteAudio.srcObject = event.streams[0];
        }
    };
    
    // Connection state handler
    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        log(`Bağlantı durumu: ${state}`, 'info');
        
        if (state === 'connected') {
            log('BAĞLANTI KURULDU!', 'success');
            AppState.isInCall = true;
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            log('Bağlantı kapatıldı veya koptu', 'warning');
            handleHangup();
        }
    };
    
    // Local stream'i ekle
    if (AppState.audioManager.localStream) {
        AppState.audioManager.localStream.getTracks().forEach(track => {
            pc.addTrack(track, AppState.audioManager.localStream);
        });
    }
    
    AppState.peerConnection = pc;
    return pc;
}

/**
 * WebRTC başlatma (Initiator - Offer gönderen taraf)
 */
async function initiateWebRTC() {
    try {
        
        const pc = createPeerConnection();
        
        // Offer oluştur
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
        
        // Local description ayarla
        await pc.setLocalDescription(offer);
        
        // Offer'ı gönder
        AppState.signalingManager.sendOffer(offer);
        log('Offer gönderildi', 'success');
        
    } catch (error) {
    }
}

/**
 * Gelen Offer'ı işle (Peer - Answer gönderen taraf)
 */
async function handleIncomingOffer(offerSdp) {
    try {
        const pc = createPeerConnection();
        
        // Remote description ayarla
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
        
        // Answer oluştur
        const answer = await pc.createAnswer();
        
        // Local description ayarla
        await pc.setLocalDescription(answer);
        
        // Answer'ı gönder
        AppState.signalingManager.sendAnswer(answer);
        
    } catch (error) {
    }
}
// Helper Functions
/**
 * Log mesajı ekle (timestamp ile)
 */
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timestamp}] ${message}`;
    
    DOM.logOutput.appendChild(entry);
    
    // Auto scroll
    DOM.logOutput.scrollTop = DOM.logOutput.scrollHeight;
}


// Cleanup & Resource Management


/**
 * Sayfa kapatılmadan önce temizlik yap
 */
window.addEventListener('beforeunload', () => {
    if (AppState.audioManager) {
        AppState.audioManager.cleanup();
    }
    
    if (AppState.peerConnection) {
        AppState.peerConnection.close();
    }
    
    if (AppState.signalingManager) {
        AppState.signalingManager.disconnect();
    }
});