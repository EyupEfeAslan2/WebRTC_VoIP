import { AudioManager } from './audio-manager.js';
import { SignalingManager } from './signaling.js';

// ============================================================================
// State (Durum)
// ============================================================================
const AppState = {
    audioManager: null,
    signalingManager: null,
    
    peers: {}, // ÇOKLU BAĞLANTI HAVUZU: { 'user_id': RTCPeerConnection }
    iceQueues: {}, // ICE Candidate kuyruğu (Erken gelen paketler için)
    
    currentRoomId: null,
    roomPassword: null,
    roomInfo: null,
    mySocketId: null,
    
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
    roomId: document.getElementById('peerId'),
    roomPassword: document.getElementById('roomPassword'),
    initAudioBtn: document.getElementById('initAudioBtn'),
    muteBtn: document.getElementById('muteBtn'),
    callBtn: document.getElementById('callBtn'),
    hangupBtn: document.getElementById('hangupBtn'),
    statusDot: document.querySelector('.status-dot'),
    statusText: document.querySelector('.status-text'),
    logOutput: document.getElementById('logOutput'),
    audioCanvas: document.getElementById('audioCanvas'),
    audioContainer: document.getElementById('audioContainer'),
    // roomInfoPanel dinamik oluşturulacak veya HTML'de varsa buraya eklenebilir
    operationsCard: document.querySelector('.operations-card')
};

// ============================================================================
// Başlatma
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeManagers();
    attachEventListeners();
    createRoomInfoPanel(); // UI panelini hazırla
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

    // --- Oda Olayları ---
    AppState.signalingManager.onRoomCreated = (data) => {
        const lockIcon = data.hasPassword ? '🔒' : '🔓';
        log(`Oda oluşturuldu: ${data.roomId} ${lockIcon} (Diğer kullanıcılar bekleniyor...)`, 'success');
        AppState.currentRoomId = data.roomId;
        updateRoomInfo(data);
    };

    AppState.signalingManager.onRoomJoined = (data) => {
        log(`Odaya katılındı: ${data.roomId} (${data.memberCount} kişi)`, 'success');
        AppState.currentRoomId = data.roomId;
        updateRoomInfo(data);
    };

    AppState.signalingManager.onRoomInfoUpdate = (data) => {
        updateRoomInfo(data);
        // log(`Oda bilgisi güncellendi: ${data.memberCount} kişi`, 'info'); // Çok spam olmasın diye kapattım
    };

    // --- Kullanıcı Olayları ---
    AppState.signalingManager.onUserConnected = async (newUserId) => {
        log(`Yeni kullanıcı geldi: ${newUserId}. Aranıyor...`, 'info');
        
        // Onun için bir bağlantı oluştur (Initiator biziz)
        const pc = createPeerConnection(newUserId);
        
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            AppState.signalingManager.sendOffer(offer, newUserId);
        } catch (e) {
            log(`Offer hatası: ${e}`, 'error');
        }
    };

    // --- KULLANICI AYRILDIĞINDA ---
    AppState.signalingManager.onUserDisconnected = (userId) => {
        log(`Kullanıcı ${userId} ayrıldı.`, 'warning');
        
        // 1. WebRTC Temizliği
        if (AppState.peers[userId]) {
            AppState.peers[userId].close();
            delete AppState.peers[userId];
        }
        
        // 2. Audio Temizliği
        const audioEl = document.getElementById(`audio_${userId}`);
        if (audioEl) audioEl.remove();

        // 3. UI GÜNCELLEME (Manual Decrement)
        // Sunucudan veri gelmesini beklemeden arayüzü anında güncelle
        const countEl = document.getElementById('infoMemberCount');
        if (countEl) {
            let currentCount = parseInt(countEl.textContent) || 1;
            // Sayı 1'den küçük olamaz
            if (currentCount > 1) {
                countEl.textContent = currentCount - 1;
            }
        }
    };

    // --- WebRTC Sinyalleşme ---
    AppState.signalingManager.onOffer = async (sdp, fromId) => {
        log(`${fromId} teklif gönderdi.`, 'info');
        
        const pc = createPeerConnection(fromId);
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            
            // Kuyruktaki ICE adaylarını işle
            processIceQueue(fromId, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            AppState.signalingManager.sendAnswer(answer, fromId);
        } catch (e) {
            log(`Answer hatası: ${e}`, 'error');
        }
    };

    AppState.signalingManager.onAnswer = async (sdp, fromId) => {
        const pc = AppState.peers[fromId];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                // Kuyruktaki ICE adaylarını işle
                processIceQueue(fromId, pc);
            } catch (e) { console.error(e); }
        }
    };

    AppState.signalingManager.onIceCandidate = async (candidate, fromId) => {
        const pc = AppState.peers[fromId];
        // Eğer PC yoksa veya remote description set edilmediyse kuyruğa at
        if (!pc || !pc.remoteDescription) {
            if (!AppState.iceQueues[fromId]) AppState.iceQueues[fromId] = [];
            AppState.iceQueues[fromId].push(candidate);
        } else {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) { console.error(e); }
        }
    };

    // --- Hata Yönetimi ---
    AppState.signalingManager.onWrongPassword = (data) => {
        log(`Yanlış şifre: ${data.roomId}`, 'error');
        alert(`Yanlış şifre! "${data.roomId}" odasına giriş yapılamadı.`);
        resetCallState();
    };

    AppState.signalingManager.onRoomFull = (data) => {
        log(`Oda dolu: ${data.roomId}`, 'error');
        alert(`Oda dolu! Maksimum kapasite aşıldı.`);
        resetCallState();
    };
    AppState.signalingManager.connect();
}

function attachEventListeners() {
    // 1. Sistemi Başlat
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
            log(`Mikrofon hatası: ${result.error}`, 'error');
            DOM.initAudioBtn.disabled = false;
        }
    });

    // 2. Odaya Gir
    DOM.callBtn.addEventListener('click', () => {
        const roomId = DOM.roomId.value.trim();
        const password = DOM.roomPassword.value.trim(); // ŞİFREYİ AL

        if (!roomId) {
            log('Lütfen Oda İsmi girin.', 'warning');
            return;
        }
        if (!AppState.audioManager.localStream) {
            log('Önce mikrofonu açın.', 'warning');
            return;
        }

        // UI Kilitle
        DOM.callBtn.disabled = true;
        DOM.hangupBtn.disabled = false;
        DOM.roomId.disabled = true;
        DOM.roomPassword.disabled = true;

        AppState.currentRoomId = roomId;
        AppState.roomPassword = password;
        
        log(`🚪 ${roomId} odasına giriliyor...`, 'info');
        
        // Şifreyi de gönder
        AppState.signalingManager.joinRoom(roomId, password);
    });

    // 3. Ayrıl
    
    DOM.hangupBtn.addEventListener('click', () => {
        // En temiz çıkış yöntemi: Sayfayı yenilemek.
        // Bu, socket'i koparır, mikrofonu kapatır, sayacı durdurur.
        location.reload(); 
    });

    // 4. Mute
    DOM.muteBtn.addEventListener('click', () => {
        const isMuted = AppState.audioManager.toggleMute();
        DOM.muteBtn.textContent = isMuted ? 'Sesi Aç' : 'Sessize Al';
        DOM.muteBtn.classList.toggle('btn-danger');
    });

    // Enter tuşu desteği
    const handleEnter = (e) => {
        if (e.key === 'Enter' && !DOM.callBtn.disabled) DOM.callBtn.click();
    };
    DOM.roomId.addEventListener('keypress', handleEnter);
    DOM.roomPassword.addEventListener('keypress', handleEnter);
}

// ============================================================================
// CORE: WebRTC Logic
// ============================================================================

function createPeerConnection(targetUserId) {
    // Varsa eskisini kapat
    if (AppState.peers[targetUserId]) {
        AppState.peers[targetUserId].close();
    }

    const pc = new RTCPeerConnection({ iceServers: AppState.iceServers });

    // A. ICE Candidate
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            AppState.signalingManager.sendIceCandidate(event.candidate, targetUserId);
        }
    };

    // B. Ses Geldiğinde
    pc.ontrack = (event) => {
        log(`🎵 Ses alındı: ${targetUserId}`, 'success');
        
        let audioEl = document.getElementById(`audio_${targetUserId}`);
        if (!audioEl) {
            audioEl = document.createElement('audio');
            audioEl.id = `audio_${targetUserId}`;
            audioEl.autoplay = true;
            DOM.audioContainer.appendChild(audioEl);
        }
        audioEl.srcObject = event.streams[0];
    };

    // C. Yerel Sesi Ekle
    if (AppState.audioManager.localStream) {
        AppState.audioManager.localStream.getTracks().forEach(track => {
            pc.addTrack(track, AppState.audioManager.localStream);
        });
    }

    AppState.peers[targetUserId] = pc;
    return pc;
}

// ICE Kuyruğunu İşle (Sesin gelmemesini önler)
function processIceQueue(userId, pc) {
    if (AppState.iceQueues[userId]) {
        AppState.iceQueues[userId].forEach(candidate => {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        });
        delete AppState.iceQueues[userId];
    }
}

// ============================================================================
// UI & Helpers
// ============================================================================

function createRoomInfoPanel() {
    if (document.getElementById('roomInfoPanel')) return;

    const operationsCard = document.querySelector('.operations-card');
    const footer = document.querySelector('.client-id-footer');

    if (operationsCard && footer) {
        const panel = document.createElement('div');
        panel.id = 'roomInfoPanel';
        
        // Temel Stil
        Object.assign(panel.style, {
            marginTop: '1rem',
            marginBottom: '1rem',
            padding: '0.8rem',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid var(--primary-color)',
            borderRadius: '8px',
            display: 'none',
            animation: 'slideIn 0.3s ease'
        });

        // HTML İskeleti
        panel.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.5rem;">
                <div style="display:flex; align-items:center; gap:0.5rem; color:var(--text-main); font-weight:600;">
                    <i class="ph ph-house-line" style="font-size:1.1rem; color:var(--primary-color);"></i>
                    <span id="infoRoomName">--</span>
                </div>
                <div id="infoLockBadge" style="display:flex; align-items:center; gap:0.3rem; font-size:0.75rem; padding:2px 6px; border-radius:4px;">
                    <i id="infoLockIcon" class="ph"></i>
                    <span id="infoLockText">--</span>
                </div>
            </div>
            
            <div style="display:flex; gap:1rem; font-size:0.8rem; color:var(--text-muted);">
                <div style="display:flex; align-items:center; gap:0.3rem;">
                    <i class="ph ph-users"></i>
                    <span>Katılımcı: <strong id="infoMemberCount" style="color:var(--text-main);">1</strong></span>
                </div>
                <div style="display:flex; align-items:center; gap:0.3rem;">
                    <i class="ph ph-clock"></i>
                    <span>Süre: <span id="sessionTimer">00:00</span></span>
                </div>
            </div>
        `;

        operationsCard.insertBefore(panel, footer);
    }
}

function updateRoomInfo(data) {
    const panel = document.getElementById('roomInfoPanel');
    if (!panel) return;

    // Paneli görünür yap
    panel.style.display = 'block';

    // Verileri güncelle (HTML'i bozmadan sadece textleri değiştir)
    document.getElementById('infoRoomName').textContent = data.roomId;
    
    // Üye sayısını güncelle
    document.getElementById('infoMemberCount').textContent = data.memberCount || 1;

    // Kilit durumu
    const lockBadge = document.getElementById('infoLockBadge');
    const lockIcon = document.getElementById('infoLockIcon');
    const lockText = document.getElementById('infoLockText');

    if (data.hasPassword) {
        lockBadge.style.color = '#fbbf24';
        lockBadge.style.border = '1px solid #fbbf24';
        lockIcon.className = 'ph ph-lock-key';
        lockText.textContent = 'Korumalı';
    } else {
        lockBadge.style.color = '#10b981';
        lockBadge.style.border = '1px solid #10b981';
        lockIcon.className = 'ph ph-lock-open';
        lockText.textContent = 'Açık';
    }

    // Sayaç çalışmıyorsa başlat
    startSessionTimer();
}

let timerInterval;
function startSessionTimer() {
    // Eğer zaten çalışıyorsa tekrar başlatma (Böylece 00:00'a dönmez)
    if (timerInterval) return;

    let seconds = 0;
    const timerEl = document.getElementById('sessionTimer');
    
    timerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        if(timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
}

// Odadan ayrılınca sayacı durdurmak için resetCallState içine ekle:
// clearInterval(timerInterval);

function handleLeaveRoom() {
    log('Odadan ayrılınıyor...', 'info');
    
    Object.keys(AppState.peers).forEach(peerId => {
        if (AppState.peers[peerId]) AppState.peers[peerId].close();
    });
    AppState.peers = {};
    AppState.iceQueues = {}; // Kuyruğu da temizle
    
    if (DOM.audioContainer) DOM.audioContainer.innerHTML = '';
    
    if (AppState.currentRoomId) {
        AppState.signalingManager.leaveRoom(AppState.currentRoomId);
    }
    
    resetCallState();
    log('Odadan ayrıldınız', 'success');
}

function resetCallState() {
    AppState.currentRoomId = null;
    AppState.roomPassword = null;
    
    DOM.callBtn.disabled = false;
    DOM.hangupBtn.disabled = true;
    DOM.roomId.disabled = false;
    DOM.roomPassword.disabled = false;
    
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    const timerEl = document.getElementById('sessionTimer');
    if (timerEl) timerEl.textContent = "00:00";
    
    // Paneli gizle
    const panel = document.getElementById('roomInfoPanel');
    if (panel) panel.style.display = 'none';
}

function log(msg, type = 'info') {
    // İkon belirle
    let iconClass = 'ph-info';
    if (type === 'success') iconClass = 'ph-check-circle';
    if (type === 'warning') iconClass = 'ph-warning';
    if (type === 'error') iconClass = 'ph-x-circle';
    if (type === 'system') iconClass = 'ph-gear';

    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    
    // Yeni HTML Yapısı
    div.innerHTML = `
        <i class="ph ${iconClass}"></i>
        <div class="log-content">
            <span class="log-time">${new Date().toLocaleTimeString()}</span>
            <span class="log-msg">${msg}</span>
        </div>
    `;
    
    if (DOM.logOutput) {
        DOM.logOutput.appendChild(div);
        DOM.logOutput.scrollTop = DOM.logOutput.scrollHeight;
    }
    console.log(`[${type.toUpperCase()}] ${msg}`);
}