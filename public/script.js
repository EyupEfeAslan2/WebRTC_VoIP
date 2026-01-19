/**
 * Main Application Script
 * WebRTC VoIP Prototype - Turkcell
 * 
 * Bu dosya tüm modülleri koordine eder ve UI ile iletişim kurar
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
    
    // ICE sunucuları (STUN)
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
    // DOM elementlerini cache'e al
    cacheDOMElements();
    
    // Managers'ı başlat
    initializeManagers();
    
    // Event listener'ları bağla
    attachEventListeners();
    
    // Başlangıç logu
    log('Uygulama başlatıldı. Mikrofon izni için butona tıklayın.', 'info');
});

// ============================================================================
// Başlatma Fonksiyonları
// ============================================================================

/**
 * DOM elementlerini cache'e alır (performance optimization)
 */
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

/**
 * Manager sınıflarını başlatır
 */
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
    
    // Signaling bağlantısını başlat
    const userId = DOM.userId.value.trim() || null;
    AppState.signalingManager.connect(userId);
}

/**
 * UI event listener'larını bağlar
 */
function attachEventListeners() {
    DOM.initAudioBtn.addEventListener('click', handleInitAudio);
    DOM.muteBtn.addEventListener('click', handleMuteToggle);
    DOM.callBtn.addEventListener('click', handleStartCall);
    DOM.hangupBtn.addEventListener('click', handleHangup);
    
    // Enter tuşu ile arama başlatma
    DOM.peerId.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !DOM.callBtn.disabled) {
            handleStartCall();
        }
    });
}

// ============================================================================
// Event Handler'lar - Audio
// ============================================================================

/**
 * Mikrofon başlatma
 */
async function handleInitAudio() {
    DOM.initAudioBtn.disabled = true;
    DOM.initAudioBtn.textContent = '⏳ Başlatılıyor...';
    
    const result = await AppState.audioManager.initializeMicrophone();
    
    if (result.success) {
        log('✅ Mikrofon başarıyla başlatıldı', 'success');
        
        // Görselleştirmeyi başlat
        AppState.audioManager.setupVisualization(DOM.audioCanvas);
        
        // UI güncellemeleri
        DOM.initAudioBtn.textContent = '✅ Mikrofon Aktif';
        DOM.muteBtn.disabled = false;
        DOM.callBtn.disabled = false;
        
    } else {
        log(`❌ Mikrofon hatası: ${result.error}`, 'error');
        DOM.initAudioBtn.disabled = false;
        DOM.initAudioBtn.textContent = '🎤 Mikrofon Başlat';
    }
}

/**
 * Mikrofon sessize alma
 */
function handleMuteToggle() {
    const isMuted = AppState.audioManager.toggleMute();
    
    if (isMuted) {
        DOM.muteBtn.textContent = '🔊 Sesi Aç';
        DOM.muteBtn.classList.add('btn-danger');
        DOM.muteBtn.classList.remove('btn-secondary');
        log('🔇 Mikrofon sessize alındı', 'warning');
    } else {
        DOM.muteBtn.textContent = '🔇 Sessize Al';
        DOM.muteBtn.classList.remove('btn-danger');
        DOM.muteBtn.classList.add('btn-secondary');
        log('🔊 Mikrofon aktif', 'success');
    }
}

/**
 * Local stream hazır olduğunda
 */
function handleLocalStreamReady(stream) {
    log('📡 Ses akışı hazır', 'info');
}

/**
 * Audio hatası
 */
function handleAudioError(error) {
    log(`❌ Audio hatası: ${error.message}`, 'error');
}

// ============================================================================
// Event Handler'lar - Signaling
// ============================================================================

/**
 * Signaling bağlantısı kuruldu
 */
function handleSignalingConnected(userId) {
    log(`🔗 Sunucuya bağlandı. User ID: ${userId}`, 'success');
    
    // UI güncelle
    DOM.statusDot.classList.add('connected');
    DOM.statusText.textContent = 'Bağlı';
    
    // User ID'yi göster
    if (!DOM.userId.value) {
        DOM.userId.value = userId;
    }
}

/**
 * Signaling bağlantısı koptu
 */
function handleSignalingDisconnected(reason) {
    log(`⚠️ Bağlantı koptu: ${reason}`, 'warning');
    
    // UI güncelle
    DOM.statusDot.classList.remove('connected');
    DOM.statusText.textContent = 'Bağlantı Koptu';
}

/**
 * Signaling hatası
 */
function handleSignalingError(error) {
    log(`❌ Signaling hatası: ${error.message}`, 'error');
}

// ============================================================================
// WebRTC Peer Connection
// ============================================================================

/**
 * Arama başlat
 */
async function handleStartCall() {
    const targetUserId = DOM.peerId.value.trim();
    
    if (!targetUserId) {
        log('⚠️ Lütfen aranacak kullanıcı ID giriniz', 'warning');
        return;
    }
    
    if (!AppState.audioManager.localStream) {
        log('⚠️ Önce mikrofonu başlatın', 'warning');
        return;
    }
    
    try {
        log(`📞 ${targetUserId} aranıyor...`, 'info');
        
        // Peer connection oluştur
        await createPeerConnection(targetUserId);
        
        // Offer oluştur ve gönder
        const offer = await AppState.peerConnection.createOffer();
        await AppState.peerConnection.setLocalDescription(offer);
        
        // Signaling ile gönder
        AppState.signalingManager.sendOffer(targetUserId, offer);
        
        // UI güncelle
        AppState.isInCall = true;
        AppState.currentPeerId = targetUserId;
        DOM.callBtn.disabled = true;
        DOM.hangupBtn.disabled = false;
        
        log(`📤 Offer gönderildi: ${targetUserId}`, 'success');
        
    } catch (error) {
        log(`❌ Arama hatası: ${error.message}`, 'error');
    }
}

/**
 * Peer connection oluştur
 */
async function createPeerConnection(targetUserId) {
    // Önceki bağlantıyı temizle
    if (AppState.peerConnection) {
        AppState.peerConnection.close();
    }
    
    // Yeni peer connection
    AppState.peerConnection = new RTCPeerConnection({
        iceServers: AppState.iceServers
    });
    
    // Local stream'i ekle
    AppState.audioManager.localStream.getTracks().forEach(track => {
        AppState.peerConnection.addTrack(track, AppState.audioManager.localStream);
    });
    
    // ICE candidate handler
    AppState.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            AppState.signalingManager.sendIceCandidate(targetUserId, event.candidate);
            log('🧊 ICE candidate gönderildi', 'info');
        }
    };
    
    // Remote stream handler
    AppState.peerConnection.ontrack = (event) => {
        log('🎵 Uzak ses akışı alındı', 'success');
        DOM.remoteAudio.srcObject = event.streams[0];
    };
    
    // Connection state handler
    AppState.peerConnection.onconnectionstatechange = () => {
        const state = AppState.peerConnection.connectionState;
        log(`🔄 Bağlantı durumu: ${state}`, 'info');
        
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            handleHangup();
        }
    };
}

/**
 * Uzak offer alındığında
 */
async function handleRemoteOffer(data) {
    try {
        log(`📥 Offer alındı: ${data.from}`, 'info');
        
        // Peer connection oluştur
        await createPeerConnection(data.from);
        
        // Remote description ayarla
        await AppState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Answer oluştur ve gönder
        const answer = await AppState.peerConnection.createAnswer();
        await AppState.peerConnection.setLocalDescription(answer);
        
        AppState.signalingManager.sendAnswer(data.from, answer);
        
        // UI güncelle
        AppState.isInCall = true;
        AppState.currentPeerId = data.from;
        DOM.callBtn.disabled = true;
        DOM.hangupBtn.disabled = false;
        
        log(`📤 Answer gönderildi: ${data.from}`, 'success');
        
    } catch (error) {
        log(`❌ Offer işleme hatası: ${error.message}`, 'error');
    }
}

/**
 * Uzak answer alındığında
 */
async function handleRemoteAnswer(data) {
    try {
        log(`📥 Answer alındı: ${data.from}`, 'info');
        
        await AppState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        
        log('✅ Bağlantı kuruldu', 'success');
        
    } catch (error) {
        log(`❌ Answer işleme hatası: ${error.message}`, 'error');
    }
}

/**
 * Uzak ICE candidate alındığında
 */
async function handleRemoteIceCandidate(data) {
    try {
        if (AppState.peerConnection) {
            await AppState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            log('🧊 ICE candidate eklendi', 'info');
        }
    } catch (error) {
        log(`❌ ICE candidate hatası: ${error.message}`, 'error');
    }
}

/**
 * Aramayı sonlandır
 */
function handleHangup() {
    if (AppState.peerConnection) {
        AppState.peerConnection.close();
        AppState.peerConnection = null;
    }
    
    // Remote audio durdur
    if (DOM.remoteAudio.srcObject) {
        DOM.remoteAudio.srcObject.getTracks().forEach(track => track.stop());
        DOM.remoteAudio.srcObject = null;
    }
    
    // UI güncelle
    AppState.isInCall = false;
    AppState.currentPeerId = null;
    DOM.callBtn.disabled = false;
    DOM.hangupBtn.disabled = true;
    
    log('📴 Arama sonlandırıldı', 'info');
}

// ============================================================================
// Yardımcı Fonksiyonlar
// ============================================================================

/**
 * Log mesajı ekle
 */
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timestamp}] ${message}`;
    
    DOM.logOutput.appendChild(entry);
    
    // Auto scroll
    DOM.logOutput.scrollTop = DOM.logOutput.scrollHeight;
    
    // Console'a da yazdır
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// ============================================================================
// Cleanup on Window Close
// ============================================================================
window.addEventListener('beforeunload', () => {
    if (AppState.audioManager) {
        AppState.audioManager.cleanup();
    }
    
    if (AppState.signalingManager) {
        AppState.signalingManager.disconnect();
    }
    
    if (AppState.peerConnection) {
        AppState.peerConnection.close();
    }
});