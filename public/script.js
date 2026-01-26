import { AudioManager } from './audio-manager.js';
import { SignalingManager } from './signaling.js';

// ============================================================================
// State (Durum)
// ============================================================================
const AppState = {
    audioManager: null,
    signalingManager: null,
    
    peers: {}, // ÇOKLU BAĞLANTI HAVUZU: { 'user_id': RTCPeerConnection, ... }
    
    currentRoomId: null,
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ============================================================================
// DOM Elementleri
// ============================================================================
const DOM = {
    userId: document.getElementById('userId'),
    roomId: document.getElementById('peerId'), // HTML'de peerId, mantıkta Room ID
    initAudioBtn: document.getElementById('initAudioBtn'),
    muteBtn: document.getElementById('muteBtn'),
    callBtn: document.getElementById('callBtn'),
    hangupBtn: document.getElementById('hangupBtn'),
    statusDot: document.querySelector('.status-dot'),
    statusText: document.querySelector('.status-text'),
    logOutput: document.getElementById('logOutput'),
    audioCanvas: document.getElementById('audioCanvas'),
    audioContainer: document.getElementById('audioContainer')
};

// ============================================================================
// Başlatma
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeManagers();
    attachEventListeners();
    log('Sistem hazır. Mikrofonu başlatın.', 'info');
});

function initializeManagers() {
    // 1. Audio
    AppState.audioManager = new AudioManager();
    AppState.audioManager.onError = (e) => log(`Audio Hatası: ${e.message}`, 'error');

    // 2. Signaling
    AppState.signalingManager = new SignalingManager();

    // --- Bağlantı Kurulduğunda ---
    AppState.signalingManager.onConnected = (myId) => {
        log(`Sunucuya bağlanıldı. ID: ${myId}`, 'success');
        DOM.userId.value = myId;
        DOM.statusDot.classList.add('connected');
        DOM.statusText.textContent = 'Sunucuya Bağlı';
    };

    // --- YENİ KULLANICI GELDİĞİNDE (Biz odadayız, o girdi) ---
    AppState.signalingManager.onUserConnected = async (newUserId) => {
        log(`Yeni kullanıcı katıldı: ${newUserId}. Aranıyor...`, 'info');
        
        // Onun için bir bağlantı oluştur
        const pc = createPeerConnection(newUserId);
        
        // Teklif (Offer) oluştur
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        // Sadece ona gönder
        AppState.signalingManager.sendOffer(offer, newUserId);
    };

    // --- KULLANICI AYRILDIĞINDA ---
    AppState.signalingManager.onUserDisconnected = (userId) => {
        log(`Kullanıcı ${userId} ayrıldı.`, 'warning');
        if (AppState.peers[userId]) {
            AppState.peers[userId].close(); // Bağlantıyı kapat
            delete AppState.peers[userId];  // Havuzdan sil
        }
        // Ses elementini kaldır
        const audioEl = document.getElementById(`audio_${userId}`);
        if (audioEl) audioEl.remove();
    };

    // --- OFFER GELDİĞİNDE (Biz yeni girdik, onlar bizi arıyor) ---
    AppState.signalingManager.onOffer = async (sdp, fromId) => {
        log(`${fromId} kullanıcısından teklif geldi.`, 'info');
        
        const pc = createPeerConnection(fromId);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        AppState.signalingManager.sendAnswer(answer, fromId);
    };

    // --- ANSWER GELDİĞİNDE ---
    AppState.signalingManager.onAnswer = async (sdp, fromId) => {
        const pc = AppState.peers[fromId];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
    };

    // --- ICE CANDIDATE ---
    AppState.signalingManager.onIceCandidate = async (candidate, fromId) => {
        const pc = AppState.peers[fromId];
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) { console.error(e); }
        }
    };

    // Bağlan
    AppState.signalingManager.connect();
}

function attachEventListeners() {
    // 1. Sistemi Başlat (Mikrofon)
    DOM.initAudioBtn.addEventListener('click', async () => {
        DOM.initAudioBtn.disabled = true;
        DOM.initAudioBtn.textContent = 'Başlatılıyor...';
        
        const result = await AppState.audioManager.initializeMicrophone();
        
        if (result.success) {
            log('Mikrofon Aktif', 'success');
            AppState.audioManager.setupVisualization(DOM.audioCanvas);
            DOM.initAudioBtn.textContent = 'Mikrofon Açık';
            DOM.muteBtn.disabled = false;
            DOM.callBtn.disabled = false;
        } else {
            log('Mikrofon hatası!', 'error');
            DOM.initAudioBtn.disabled = false;
        }
    });

    // 2. Odaya Gir
    DOM.callBtn.addEventListener('click', () => {
        const roomId = DOM.roomId.value.trim();
        if (!roomId) {
            log('Lütfen Oda İsmi girin.', 'warning');
            return;
        }
        if (!AppState.audioManager.localStream) {
            log('Önce mikrofonu açın.', 'warning');
            return;
        }

        DOM.callBtn.disabled = true;
        DOM.hangupBtn.disabled = false;
        DOM.roomId.disabled = true;

        AppState.currentRoomId = roomId;
        log(`${roomId} odasına giriliyor...`, 'info');
        AppState.signalingManager.joinRoom(roomId);
    });

    // 3. Ayrıl
    DOM.hangupBtn.addEventListener('click', () => {
        location.reload(); // En temiz çıkış yöntemi
    });

    // 4. Mute
    DOM.muteBtn.addEventListener('click', () => {
        const isMuted = AppState.audioManager.toggleMute();
        DOM.muteBtn.textContent = isMuted ? 'Sesi Aç' : 'Sessize Al';
        DOM.muteBtn.classList.toggle('btn-danger');
    });
}

// ============================================================================
// CORE: Çoklu PeerConnection Oluşturucu
// ============================================================================
function createPeerConnection(targetUserId) {
    const pc = new RTCPeerConnection({ iceServers: AppState.iceServers });

    // A. ICE Candidate buldukça karşıya gönder
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            AppState.signalingManager.sendIceCandidate(event.candidate, targetUserId);
        }
    };

    // B. Karşıdan ses (Track) geldiğinde
    pc.ontrack = (event) => {
        log(`Ses alındı: ${targetUserId}`, 'success');
        
        // Dinamik Audio Elementi Oluştur
        let audioEl = document.getElementById(`audio_${targetUserId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio_${targetUserId}`;
            audioEl.autoplay = true;
            // audioEl.controls = true; // Debug için açabilirsin
            DOM.audioContainer.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    // C. Kendi sesimizi ekle
    if (AppState.audioManager.localStream) {
        AppState.audioManager.localStream.getTracks().forEach(track => {
            pc.addTrack(track, AppState.audioManager.localStream);
        });
    }

    // D. Bağlantıyı havuza kaydet
    AppState.peers[targetUserId] = pc;
    return pc;
}

// ============================================================================
// Helper Log
// ============================================================================
function log(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.style.color = type === 'error' ? '#ef4444' : (type === 'success' ? '#3b82f6' : '#4ade80');
    div.innerHTML = `<span>[${new Date().toLocaleTimeString()}]</span> > ${msg}`;
    DOM.logOutput.appendChild(div);
    DOM.logOutput.scrollTop = DOM.logOutput.scrollHeight;
}