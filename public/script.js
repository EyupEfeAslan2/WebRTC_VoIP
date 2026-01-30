/**
 * Main Application - Multi-Peer WebRTC with Video Grid & Speaking Detection
 */

import { AudioManager } from './audio-manager.js';
import { SignalingManager } from './signaling.js';

// ============================================================================
// Application State
// ============================================================================
const AppState = {
    audioManager: null,
    signalingManager: null,
    
    peers: {},
    iceQueues: {},
    audioMonitors: {}, // Speaking detection için
    
    currentRoomId: null,
    roomPassword: null,
    roomInfo: null,
    mySocketId: null,
    
    // Toggle States
    isMicMuted: false,
    isCameraOn: false,
    isChatOpen: false,
    
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ============================================================================
// DOM Cache
// ============================================================================
const DOM = {
    userId: document.getElementById('userId'),
    roomId: document.getElementById('peerId'),
    roomPassword: document.getElementById('roomPassword'),
    initAudioBtn: document.getElementById('initAudioBtn'),
    callBtn: document.getElementById('callBtn'),
    hangupBtn: document.getElementById('hangupBtn'),
    
    // Video controls
    micToggleBtn: document.getElementById('micToggleBtn'),
    cameraToggleBtn: document.getElementById('cameraToggleBtn'),
    screenShareBtn: document.getElementById('screenShareBtn'),
    chatToggleBtn: document.getElementById('chatToggleBtn'),
    
    statusDot: document.querySelector('.status-dot'),
    statusText: document.querySelector('.status-text'),
    logOutput: document.getElementById('logOutput'),
    audioCanvas: document.getElementById('audioCanvas'),
    audioContainer: document.getElementById('audioContainer'),
    
    videoGrid: document.getElementById('videoGrid'),
    localVideo: document.getElementById('localVideo'),
    localVideoWrapper: document.getElementById('localVideoWrapper'),
    localMicStatus: document.getElementById('localMicStatus'),
    
    chatColumn: document.getElementById('chatColumn'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    sendMessageBtn: document.getElementById('sendMessageBtn'),
    closeChatBtn: document.getElementById('closeChatBtn'),
    
    operationsCard: document.querySelector('.operations-card'),
    appMain: document.querySelector('.app-main')
};

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    initializeManagers();
    attachEventListeners();
    createRoomInfoPanel();
    
    // Chat başlangıçta kapalı
    DOM.appMain.classList.add('chat-closed');
    
    log('Sistem hazır. Başlatın.', 'system');
});

function initializeManagers() {
    // Audio Manager
    AppState.audioManager = new AudioManager();
    AppState.audioManager.onError = (e) => log(`Audio Hatası: ${e.message}`, 'error');

    // Signaling Manager
    AppState.signalingManager = new SignalingManager();

    // Connection events
    AppState.signalingManager.onConnected = (myId) => {
        AppState.mySocketId = myId;
        log(`Bağlandı. ID: ${myId}`, 'success');
        DOM.userId.value = myId;
        DOM.statusDot.classList.add('connected');
        DOM.statusText.textContent = 'Sunucuya Bağlı';
    };

    // Room events
    AppState.signalingManager.onRoomCreated = (data) => {
        const lockIcon = data.hasPassword ? '🔒' : '🔓';
        log(`Oda oluşturuldu: ${data.roomId} ${lockIcon}`, 'success');
        AppState.currentRoomId = data.roomId;
        updateRoomInfo(data);
    };

    AppState.signalingManager.onRoomJoined = (data) => {
        log(`Odaya katılındı: ${data.roomId}`, 'success');
        AppState.currentRoomId = data.roomId;
        updateRoomInfo(data);
    };

    AppState.signalingManager.onRoomInfoUpdate = (data) => {
        updateRoomInfo(data);
    };

    // User events
    AppState.signalingManager.onUserConnected = async (newUserId) => {
        log(`Yeni kullanıcı: ${newUserId}`, 'info');
        
        const pc = createPeerConnection(newUserId);
        
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            AppState.signalingManager.sendOffer(offer, newUserId);
        } catch (e) {
            log(`Offer hatası: ${e.message}`, 'error');
        }
    };

    AppState.signalingManager.onUserDisconnected = (userId) => {
        log(`Kullanıcı ayrıldı: ${userId}`, 'warning');
        
        // Peer bağlantısını kapat
        if (AppState.peers[userId]) {
            AppState.peers[userId].close();
            delete AppState.peers[userId];
        }
        
        // Audio monitor'ü durdur
        if (AppState.audioMonitors[userId]) {
            AppState.audioMonitors[userId].disconnect();
            delete AppState.audioMonitors[userId];
        }
        
        // Video wrapper'ı kaldır
        const wrapper = document.getElementById(`video_${userId}`);
        if (wrapper) wrapper.remove();
        
        // Audio element'i kaldır
        const audioEl = document.getElementById(`audio_${userId}`);
        if (audioEl) audioEl.remove();
        
        // Grid class güncelle
        updateVideoGridClass();

        const countEl = document.getElementById('infoMemberCount');
        if (countEl) {
            let currentCount = parseInt(countEl.textContent) || 1;
            if (currentCount > 1) {
                countEl.textContent = currentCount - 1;
            }
        }
    };

    // WebRTC signaling
    AppState.signalingManager.onOffer = async (sdp, fromId) => {
        log(`${fromId} teklif gönderdi`, 'info');
        
        const pc = createPeerConnection(fromId);
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            processIceQueue(fromId, pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            AppState.signalingManager.sendAnswer(answer, fromId);
        } catch (e) {
            log(`Answer hatası: ${e.message}`, 'error');
        }
    };

    AppState.signalingManager.onAnswer = async (sdp, fromId) => {
        const pc = AppState.peers[fromId];
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                processIceQueue(fromId, pc);
            } catch (e) { console.error(e); }
        }
    };

    AppState.signalingManager.onIceCandidate = async (candidate, fromId) => {
        const pc = AppState.peers[fromId];
        if (!pc || !pc.remoteDescription) {
            if (!AppState.iceQueues[fromId]) AppState.iceQueues[fromId] = [];
            AppState.iceQueues[fromId].push(candidate);
        } else {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) { console.error(e); }
        }
    };

    // Error handling
    AppState.signalingManager.onWrongPassword = (data) => {
        log(`Yanlış şifre: ${data.roomId}`, 'error');
        alert(`Yanlış şifre!`);
        resetCallState();
    };

    AppState.signalingManager.onRoomFull = (data) => {
        log(`Oda dolu: ${data.roomId}`, 'error');
        alert(`Oda dolu!`);
        resetCallState();
    };

    AppState.signalingManager.connect();
}

function attachEventListeners() {
    // Sistemi Başlat
    DOM.initAudioBtn.addEventListener('click', async () => {
        const isInitialized = AppState.audioManager.localStream !== null;
        
        if (!isInitialized) {
            DOM.initAudioBtn.disabled = true;
            DOM.initAudioBtn.innerHTML = '<i class="ph ph-circle-notch ph-spin"></i><span>Başlatılıyor...</span>';
            
            const result = await AppState.audioManager.initializeMicrophone();
            
            if (result.success) {
                log('Mikrofon aktif', 'success');

                DOM.localVideo.srcObject = AppState.audioManager.localStream;
                AppState.audioManager.setupVisualization(DOM.audioCanvas);
                
                DOM.initAudioBtn.innerHTML = '<i class="ph ph-check"></i><span>Başlatıldı</span>';
                DOM.initAudioBtn.classList.remove('btn-primary');
                DOM.initAudioBtn.classList.add('btn-success');
                DOM.initAudioBtn.disabled = true;
                
                // Kontrol butonlarını aktif et
                DOM.micToggleBtn.disabled = false;
                DOM.cameraToggleBtn.disabled = false;
                DOM.screenShareBtn.disabled = false;
                DOM.callBtn.disabled = false;
                
                // Mikrofon başlangıçta açık
                DOM.micToggleBtn.classList.add('btn-control-danger');
                
                AppState.isMicMuted = false;
                updateMicStatusIcon();
                
                // Yerel konuşma algılama
                startLocalSpeakingDetection();
                
            } else {
                log(`Mikrofon hatası: ${result.error}`, 'error');
                DOM.initAudioBtn.disabled = false;
                DOM.initAudioBtn.innerHTML = '<i class="ph ph-power"></i><span>Sistemi Başlat</span>';
            }
        }
    });

    // Mikrofon Toggle
    DOM.micToggleBtn.addEventListener('click', () => {
        AppState.isMicMuted = !AppState.isMicMuted;
        
        const audioTrack = AppState.audioManager.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !AppState.isMicMuted;
        }
        
        if (AppState.isMicMuted) {
            DOM.micToggleBtn.innerHTML = '<i class="ph ph-microphone-slash"></i>';
            DOM.micToggleBtn.classList.remove('btn-control-danger');
            log('Mikrofon kapatıldı', 'warning');
        } else {
            DOM.micToggleBtn.innerHTML = '<i class="ph ph-microphone"></i>';
            DOM.micToggleBtn.classList.add('btn-control-danger');
            log('Mikrofon açıldı', 'success');
        }
        
        updateMicStatusIcon();
    });

    // Kamera Toggle
    DOM.cameraToggleBtn.addEventListener('click', () => {
        AppState.isCameraOn = !AppState.isCameraOn;
        
        const videoTrack = AppState.audioManager.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = AppState.isCameraOn;
        }
        
        if (AppState.isCameraOn) {
            DOM.cameraToggleBtn.innerHTML = '<i class="ph ph-video-camera"></i>';
            DOM.cameraToggleBtn.classList.add('active');
            DOM.localVideoWrapper.classList.remove('cam-off');
            log('Kamera açıldı', 'success');
        } else {
            DOM.cameraToggleBtn.innerHTML = '<i class="ph ph-video-camera-slash"></i>';
            DOM.cameraToggleBtn.classList.remove('active');
            DOM.localVideoWrapper.classList.add('cam-off');
            log('Kamera kapatıldı', 'warning');
        }
    });

    // Chat Toggle
    DOM.chatToggleBtn.addEventListener('click', () => {
        AppState.isChatOpen = !AppState.isChatOpen;
        
        if (AppState.isChatOpen) {
            DOM.appMain.classList.remove('chat-closed');
            DOM.chatToggleBtn.classList.add('active');
        } else {
            DOM.appMain.classList.add('chat-closed');
            DOM.chatToggleBtn.classList.remove('active');
        }
    });
    
    DOM.closeChatBtn.addEventListener('click', () => {
        DOM.chatToggleBtn.click();
    });

    // Odaya Gir
    DOM.callBtn.addEventListener('click', () => {
        const roomId = DOM.roomId.value.trim();
        const password = DOM.roomPassword.value.trim();

        if (!roomId) {
            log('Oda ismi girin', 'warning');
            return;
        }
        if (!AppState.audioManager.localStream) {
            log('Önce mikrofonu açın', 'warning');
            return;
        }

        DOM.callBtn.disabled = true;
        DOM.hangupBtn.disabled = false;
        DOM.roomId.disabled = true;
        DOM.roomPassword.disabled = true;

        AppState.currentRoomId = roomId;
        AppState.roomPassword = password;
        
        log(`Odaya giriliyor: ${roomId}`, 'info');
        AppState.signalingManager.joinRoom(roomId, password);
    });

    // Ayrıl
    DOM.hangupBtn.addEventListener('click', () => {
        if (confirm('Odadan ayrılmak istediğinize emin misiniz?')) {
            handleLeaveRoom();
        }
    });

    // Chat gönder
    DOM.sendMessageBtn.addEventListener('click', sendChatMessage);
    DOM.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // Enter tuşu desteği
    const handleEnter = (e) => {
        if (e.key === 'Enter' && !DOM.callBtn.disabled) DOM.callBtn.click();
    };
    DOM.roomId.addEventListener('keypress', handleEnter);
    DOM.roomPassword.addEventListener('keypress', handleEnter);
}

// ============================================================================
// Speaking Detection
// ============================================================================
function startLocalSpeakingDetection() {
    if (!AppState.audioManager.localStream) return;
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(AppState.audioManager.localStream);
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    javascriptNode.onaudioprocess = function() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
            values += array[i];
        }
        const average = values / length;

        if (DOM.localVideoWrapper) {
            if (average > 15 && !AppState.isMicMuted) {
                DOM.localVideoWrapper.classList.add('speaking');
            } else {
                DOM.localVideoWrapper.classList.remove('speaking');
            }
        }
    };
}

function startRemoteSpeakingDetection(stream, userId) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    microphone.connect(analyser);
    analyser.connect(javascriptNode);
    javascriptNode.connect(audioContext.destination);

    javascriptNode.onaudioprocess = function() {
        const array = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(array);
        let values = 0;
        const length = array.length;
        for (let i = 0; i < length; i++) {
            values += array[i];
        }
        const average = values / length;

        const wrapper = document.getElementById(`video_${userId}`);
        if (wrapper) {
            if (average > 15) {
                wrapper.classList.add('speaking');
            } else {
                wrapper.classList.remove('speaking');
            }
        }
    };
    
    AppState.audioMonitors[userId] = { analyser, javascriptNode };
}

// ============================================================================
// WebRTC Core
// ============================================================================
function createPeerConnection(targetUserId) {
    if (AppState.peers[targetUserId]) {
        AppState.peers[targetUserId].close();
    }

    const pc = new RTCPeerConnection({ iceServers: AppState.iceServers });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            AppState.signalingManager.sendIceCandidate(event.candidate, targetUserId);
        }
    };

    pc.ontrack = (event) => {
        const stream = event.streams[0];
        const trackKind = event.track.kind;
        
        // Video wrapper oluştur/güncelle
        let wrapper = document.getElementById(`video_${targetUserId}`);
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.id = `video_${targetUserId}`;
            wrapper.className = 'video-wrapper';
            
            const shortId = targetUserId.substring(0, 6);
            
            wrapper.innerHTML = `
                <video autoplay playsinline></video>
                <div class="video-overlay">
                    <span class="video-label">User ${shortId}</span>
                    <div class="video-status-icon">
                        <i class="ph ph-microphone"></i>
                    </div>
                </div>
                <div class="no-video-placeholder">
                    <i class="ph ph-user"></i>
                </div>
            `;
            
            DOM.videoGrid.appendChild(wrapper);
            updateVideoGridClass();
        }
        
        const videoEl = wrapper.querySelector('video');
        
        if (trackKind === 'video') {
            videoEl.srcObject = stream;
            wrapper.classList.remove('cam-off');
            
            event.track.onmute = () => {
                wrapper.classList.add('cam-off');
            };
            event.track.onunmute = () => {
                wrapper.classList.remove('cam-off');
            };
            
            log(`Görüntü alındı: ${targetUserId}`, 'success');
        }
        
        if (trackKind === 'audio') {
            // Audio için ayrı element
            let audioEl = document.getElementById(`audio_${targetUserId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio_${targetUserId}`;
                audioEl.autoplay = true;
                DOM.audioContainer.appendChild(audioEl);
            }
            audioEl.srcObject = stream;
            
            // Speaking detection başlat
            startRemoteSpeakingDetection(stream, targetUserId);
            
            log(`Ses alındı: ${targetUserId}`, 'success');
        }
    };

    if (AppState.audioManager.localStream) {
        AppState.audioManager.localStream.getTracks().forEach(track => {
            pc.addTrack(track, AppState.audioManager.localStream);
        });
    }

    AppState.peers[targetUserId] = pc;
    return pc;
}

function processIceQueue(userId, pc) {
    if (AppState.iceQueues[userId]) {
        AppState.iceQueues[userId].forEach(candidate => {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        });
        delete AppState.iceQueues[userId];
    }
}

// ============================================================================
// UI Helpers
// ============================================================================
function updateVideoGridClass() {
    const peerCount = Object.keys(AppState.peers).length + 1; // +1 kendimiz
    DOM.videoGrid.className = 'video-grid';
    DOM.videoGrid.classList.add(`peers-${peerCount}`);
}

function updateMicStatusIcon() {
    if (AppState.isMicMuted) {
        DOM.localMicStatus.innerHTML = '<i class="ph ph-microphone-slash"></i>';
        DOM.localMicStatus.style.background = 'rgba(239, 68, 68, 0.8)';
    } else {
        DOM.localMicStatus.innerHTML = '<i class="ph ph-microphone"></i>';
        DOM.localMicStatus.style.background = 'rgba(16, 185, 129, 0.8)';
    }
}

function sendChatMessage() {
    const message = DOM.chatInput.value.trim();
    if (!message) return;
    
    addChatMessage('Siz', message, true);
    DOM.chatInput.value = '';
    
    // TODO: Send to peers via data channel
}

function addChatMessage(sender, message, isOwn = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
    
    msgDiv.innerHTML = `
        <span class="message-sender">${sender}</span>
        <div class="message-bubble">${message}</div>
    `;
    
    // Empty state'i kaldır
    const empty = DOM.chatMessages.querySelector('.chat-empty');
    if (empty) empty.remove();
    
    DOM.chatMessages.appendChild(msgDiv);
    DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
}

function createRoomInfoPanel() {
    if (document.getElementById('roomInfoPanel')) return;

    const operationsCard = document.querySelector('.operations-card');
    const footer = document.querySelector('.client-id-footer');

    if (operationsCard && footer) {
        const panel = document.createElement('div');
        panel.id = 'roomInfoPanel';
        
        Object.assign(panel.style, {
            marginTop: '1rem',
            marginBottom: '1rem',
            padding: '0.8rem',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid var(--primary-color)',
            borderRadius: '8px',
            display: 'none'
        });

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

    panel.style.display = 'block';

    document.getElementById('infoRoomName').textContent = data.roomId;
    document.getElementById('infoMemberCount').textContent = data.memberCount || 1;

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

    startSessionTimer();
}

let timerInterval;
function startSessionTimer() {
    if (timerInterval) return;

    let seconds = 0;
    const timerEl = document.getElementById('sessionTimer');
    
    timerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }, 1000);
}

function handleLeaveRoom() {
    log('Odadan ayrılınıyor...', 'info');
    
    Object.keys(AppState.peers).forEach(peerId => {
        if (AppState.peers[peerId]) AppState.peers[peerId].close();
    });
    AppState.peers = {};
    AppState.iceQueues = {};
    AppState.audioMonitors = {};
    
    // Video wrapper'ları temizle
    const remoteWrappers = DOM.videoGrid.querySelectorAll('.video-wrapper:not(.local)');
    remoteWrappers.forEach(w => w.remove());
    
    if (DOM.audioContainer) DOM.audioContainer.innerHTML = '';
    
    if (AppState.currentRoomId) {
        AppState.signalingManager.leaveRoom(AppState.currentRoomId);
    }
    
    updateVideoGridClass();
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
    
    const panel = document.getElementById('roomInfoPanel');
    if (panel) panel.style.display = 'none';
}

function log(msg, type = 'info') {
    let iconClass = 'ph-info';
    if (type === 'success') iconClass = 'ph-check-circle';
    if (type === 'warning') iconClass = 'ph-warning';
    if (type === 'error') iconClass = 'ph-x-circle';
    if (type === 'system') iconClass = 'ph-gear';

    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    
    div.innerHTML = `
        <i class="ph ${iconClass}"></i>
        <div class="log-content">
            <span class="log-time">${new Date().toLocaleTimeString('tr-TR')}</span>
            <span class="log-msg">${msg}</span>
        </div>
    `;
    
    if (DOM.logOutput) {
        DOM.logOutput.appendChild(div);
        DOM.logOutput.scrollTop = DOM.logOutput.scrollHeight;
    }
    console.log(`[${type.toUpperCase()}] ${msg}`);
}

// ============================================================================
// Cleanup
// ============================================================================
window.addEventListener('beforeunload', () => {
    if (AppState.audioManager) {
        AppState.audioManager.cleanup();
    }
    
    Object.values(AppState.peers).forEach(pc => pc.close());
    
    if (AppState.currentRoomId) {
        AppState.signalingManager.leaveRoom(AppState.currentRoomId);
    }
    
    if (AppState.signalingManager) {
        AppState.signalingManager.disconnect();
    }
});