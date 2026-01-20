/**
 * Main Application Script
 * WebRTC VoIP Prototype - Turkcell
 * * Bu dosya tüm modülleri koordine eder ve UI ile iletişim kurar
 */

import { AudioManager } from './audio-manager.js';
import { SignalingManager } from './signaling.js';

// ============================================================================
// Uygulama Durumu (State Management)
// ============================================================================
const AppState = {
    audioManager: null,
    signalingManager: null,
    peerConnection: null,
    isInCall: false,
    currentPeerId: null,
    
    // ICE sunucuları (STUN - Google Public Servers)
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// ============================================================================
// DOM Elementleri (Cache)
// ============================================================================
const DOM = {
    userId: null,
    peerId: null,
    initAudioBtn: null,
    muteBtn: null,
    callBtn: null,
    hangupBtn: null,
    connectionStatus: null,
    statusDot: null,
    statusText: null,
    logOutput: null,
    audioCanvas: null,
    remoteAudio: null
};

// ============================================================================
// Uygulama Başlatma
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    initializeManagers();
    attachEventListeners();
    log('Uygulama başlatıldı. Mikrofon izni için "Sistemi Başlat"a tıklayın.', 'info');
});

// ============================================================================
// Başlatma Fonksiyonları
// ============================================================================

function cacheDOMElements() {
    DOM.userId = document.getElementById('userId');
    DOM.peerId = document.getElementById('peerId');
    DOM.initAudioBtn = document.getElementById('initAudioBtn');
    DOM.muteBtn = document.getElementById('muteBtn');
    DOM.callBtn = document.getElementById('callBtn');
    DOM.hangupBtn = document.getElementById('hangupBtn');
    DOM.connectionStatus = document.getElementById('connectionStatus');
    DOM.statusDot = DOM.connectionStatus.querySelector('.status-dot');
    DOM.statusText = DOM.connectionStatus.querySelector('.status-text');
    DOM.logOutput = document.getElementById('logOutput');
    DOM.audioCanvas = document.getElementById('audioCanvas');
    DOM.remoteAudio = document.getElementById('remoteAudio');
}

function initializeManagers() {
    // Audio Manager
    AppState.audioManager = new AudioManager();
    AppState.audioManager.onStreamReady = handleLocalStreamReady;
    AppState.audioManager.onError = handleAudioError;
    
    // Signaling Manager
    AppState.signalingManager = new SignalingManager();
    AppState.signalingManager.onConnected = handleSignalingConnected;
    AppState.signalingManager.onDisconnected = handleSignalingDisconnected;
    AppState.signalingManager.onOffer = handleRemoteOffer;
    AppState.signalingManager.onAnswer = handleRemoteAnswer;
    AppState.signalingManager.onIceCandidate = handleRemoteIceCandidate;
    AppState.signalingManager.onError = handleSignalingError;
    
    // Bağlantıyı başlat
    const userId = DOM.userId.value.trim() || null;
    AppState.signalingManager.connect(userId);
}

function attachEventListeners() {
    DOM.initAudioBtn.addEventListener('click', handleInitAudio);
    DOM.muteBtn.addEventListener('click', handleMuteToggle);
    DOM.callBtn.addEventListener('click', handleStartCall);
    DOM.hangupBtn.addEventListener('click', handleHangup);
    
    DOM.peerId.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !DOM.callBtn.disabled) {
            handleStartCall();
        }
    });
}

// ============================================================================
// Event Handler'lar - Audio
// ============================================================================

async function handleInitAudio() {
    DOM.initAudioBtn.disabled = true;
    DOM.initAudioBtn.textContent = 'Başlatılıyor...';
    
    const result = await AppState.audioManager.initializeMicrophone();
    
    if (result.success) {
        log('Mikrofon başarıyla başlatıldı', 'success');
        AppState.audioManager.setupVisualization(DOM.audioCanvas);
        DOM.initAudioBtn.textContent = 'Mikrofon Aktif';
        DOM.muteBtn.disabled = false;
        DOM.callBtn.disabled = false;
    } else {
        log(`Mikrofon hatası: ${result.error}`, 'error');
        DOM.initAudioBtn.disabled = false;
        DOM.initAudioBtn.textContent = 'Mikrofon Başlat';
    }
}

function handleMuteToggle() {
    const isMuted = AppState.audioManager.toggleMute();
    if (isMuted) {
        DOM.muteBtn.textContent = 'Sesi Aç';
        DOM.muteBtn.classList.add('btn-danger');
        log('Mikrofon sessize alındı', 'warning');
    } else {
        DOM.muteBtn.textContent = 'Sessize Al';
        DOM.muteBtn.classList.remove('btn-danger');
        log('Mikrofon aktif', 'success');
    }
}

function handleLocalStreamReady(stream) {
    // Local stream hazır olduğunda yapılacaklar (gerekirse)
}

function handleAudioError(error) {
    log(`Audio hatası: ${error.message}`, 'error');
}

// ============================================================================
// Event Handler'lar - Signaling
// ============================================================================

function handleSignalingConnected(userId) {
    log(`Sunucuya bağlandı. ID: ${userId}`, 'success');
    DOM.statusDot.classList.add('connected');
    DOM.statusText.textContent = 'Bağlı';
    if (!DOM.userId.value) DOM.userId.value = userId;
}

function handleSignalingDisconnected(reason) {
    log(`Bağlantı koptu: ${reason}`, 'warning');
    DOM.statusDot.classList.remove('connected');
    DOM.statusText.textContent = 'Bağlantı Koptu';
}

function handleSignalingError(error) {
    log(`Signaling hatası: ${error.message}`, 'error');
}

// ============================================================================
// 🔥 WebRTC CORE LOGIC (EN ÖNEMLİ KISIM)
// ============================================================================

/**
 * Yeni bir PeerConnection oluşturur ve medya olaylarını bağlar
 */
async function createPeerConnection(targetUserId) {
    // Varsa eski bağlantıyı temizle
    if (AppState.peerConnection) {
        AppState.peerConnection.close();
    }

    log('WebRTC bağlantısı hazırlanıyor...', 'info');

    // 1. Yeni bağlantı nesnesi oluştur
    AppState.peerConnection = new RTCPeerConnection({
        iceServers: AppState.iceServers
    });
    
    // 2. KENDİ SESİMİZİ EKLEME (SENDER)
    // Bunu yapmazsak karşı taraf bizi duyamaz!
    if (AppState.audioManager.localStream) {
        AppState.audioManager.localStream.getTracks().forEach(track => {
            AppState.peerConnection.addTrack(track, AppState.audioManager.localStream);
        });
        log('Yerel ses akışı bağlantıya eklendi.', 'info');
    } else {
        log('HATA: Yerel ses akışı bulunamadı!', 'error');
    }
    
    // 3. KARŞI TARAFIN SESİNİ DUYMA (RECEIVER)
    // Karşıdan bir track (ses) geldiğinde bu tetiklenir
    AppState.peerConnection.ontrack = (event) => {
        console.log('Stream Geldi:', event.streams);
        log('🎵 Uzak ses akışı alındı!', 'success');
        
        // HTML Audio elementine bağla
        if (DOM.remoteAudio.srcObject !== event.streams[0]) {
            DOM.remoteAudio.srcObject = event.streams[0];
            log('Ses hoparlöre verildi.', 'success');
        }
    };
    
    // 4. ICE Adaylarını Yönetme
    AppState.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            AppState.signalingManager.sendIceCandidate(targetUserId, event.candidate);
        }
    };
    
    // 5. Bağlantı Durumu İzleme
    AppState.peerConnection.onconnectionstatechange = () => {
        const state = AppState.peerConnection.connectionState;
        log(`Bağlantı durumu: ${state}`, 'info');
        if (state === 'connected') {
            log('✅ P2P Bağlantısı Başarılı!', 'success');
        }
        if (state === 'disconnected' || state === 'failed') {
            handleHangup();
        }
    };
}

/**
 * ARAMA BAŞLATMA (Caller)
 */
async function handleStartCall() {
    const targetUserId = DOM.peerId.value.trim();
    
    if (!targetUserId) {
        log('Lütfen hedef ID giriniz', 'warning');
        return;
    }
    
    if (!AppState.audioManager.localStream) {
        log('Önce mikrofonu başlatın!', 'warning');
        return;
    }
    
    try {
        log(`${targetUserId} aranıyor...`, 'info');
        
        // Önce bağlantıyı kur ve streamleri ekle
        await createPeerConnection(targetUserId);
        
        // Sonra teklif (Offer) oluştur
        const offer = await AppState.peerConnection.createOffer();
        await AppState.peerConnection.setLocalDescription(offer);
        
        AppState.signalingManager.sendOffer(targetUserId, offer);
        
        AppState.isInCall = true;
        AppState.currentPeerId = targetUserId;
        updateUICallState(true);
        
        log(`Offer gönderildi -> ${targetUserId}`, 'success');
        
    } catch (error) {
        log(`Arama hatası: ${error.message}`, 'error');
    }
}

/**
 * ARAMA CEVAPLAMA (Callee)
 */
async function handleRemoteOffer(data) {
    try {
        log(`Arama geldi: ${data.from}`, 'info');
        
        // Bağlantıyı kur ve streamleri ekle
        await createPeerConnection(data.from);
        
        // Karşı tarafın teklifini kabul et
        await AppState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Cevap (Answer) oluştur
        const answer = await AppState.peerConnection.createAnswer();
        await AppState.peerConnection.setLocalDescription(answer);
        
        AppState.signalingManager.sendAnswer(data.from, answer);
        
        AppState.isInCall = true;
        AppState.currentPeerId = data.from;
        updateUICallState(true);
        
        log(`Cevaplandı -> ${data.from}`, 'success');
        
    } catch (error) {
        log(`Offer işleme hatası: ${error.message}`, 'error');
    }
}

async function handleRemoteAnswer(data) {
    try {
        log(`Cevap alındı: ${data.from}`, 'info');
        await AppState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (error) {
        log(`Answer hatası: ${error.message}`, 'error');
    }
}

async function handleRemoteIceCandidate(data) {
    try {
        if (AppState.peerConnection) {
            await AppState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('ICE hatası', error);
    }
}

function handleHangup() {
    if (AppState.peerConnection) {
        AppState.peerConnection.close();
        AppState.peerConnection = null;
    }
    
    if (DOM.remoteAudio.srcObject) {
        DOM.remoteAudio.srcObject.getTracks().forEach(track => track.stop());
        DOM.remoteAudio.srcObject = null;
    }
    
    AppState.isInCall = false;
    AppState.currentPeerId = null;
    updateUICallState(false);
    
    log('Arama sonlandırıldı', 'info');
}

// ============================================================================
// Yardımcı Fonksiyonlar
// ============================================================================

function updateUICallState(inCall) {
    DOM.callBtn.disabled = inCall;
    DOM.hangupBtn.disabled = !inCall;
    DOM.peerId.disabled = inCall;
}

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    let color = '#4ade80';
    if (type === 'error') color = '#ef4444';
    if (type === 'warning') color = '#f59e0b';
    if (type === 'success') color = '#3b82f6';
    
    entry.style.color = color;
    entry.innerHTML = `<span style="opacity:0.6">[${timestamp}]</span> > ${message}`;
    
    DOM.logOutput.appendChild(entry);
    DOM.logOutput.scrollTop = DOM.logOutput.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ============================================================================
// Cleanup
// ============================================================================
window.addEventListener('beforeunload', () => {
    if (AppState.audioManager) AppState.audioManager.cleanup();
    if (AppState.signalingManager) AppState.signalingManager.disconnect();
    if (AppState.peerConnection) AppState.peerConnection.close();
});