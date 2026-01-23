/**
 * AudioManager - Mikrofon ve ses akışı yönetimi
 */

export class AudioManager {
    constructor() {
        this.localStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isMuted = false;
        
        // Canvas ve görselleştirme
        this.canvas = null;
        this.canvasContext = null;
        this.animationId = null;
        
        // Callbacks
        this.onStreamReady = null;
        this.onError = null;
    }

    /**
     * Mikrofon izni alır ve ses akışını başlatır
     */
    async initializeMicrophone() {
        try {
            // getUserMedia constraints - ses kalitesi optimizasyonu
            const constraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1
                },
                video: false
            };

            // Mikrofon erişimi
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // AudioContext oluştur
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            
            // Mikrofon kaynağını bağla
            this.microphone = this.audioContext.createMediaStreamSource(this.localStream);
            this.microphone.connect(this.analyser);
            
            // Callback tetikle
            if (this.onStreamReady) {
                this.onStreamReady(this.localStream);
            }
            
            return {
                success: true,
                stream: this.localStream
            };
            
        } catch (error) {
            if (this.onError) {
                this.onError(error);
            }
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Canvas'a ses görselleştirmesi çizer
     */
    setupVisualization(canvasElement) {
        if (!canvasElement || !this.analyser) {
            return;
        }

        this.canvas = canvasElement;
        this.canvasContext = this.canvas.getContext('2d');
        
        // Canvas boyutlarını ayarla (Retina desteği)
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvasContext.scale(dpr, dpr);
        
        // Görselleştirmeyi başlat
        this._visualize();
    }

    /**
     * Ses dalgası görselleştirmesi (waveform)
     * @private
     */
    _visualize() {
        if (!this.analyser || !this.canvasContext) {
            return;
        }

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const draw = () => {
            this.animationId = requestAnimationFrame(draw);
            
            this.analyser.getByteTimeDomainData(dataArray);
            
            const { width, height } = this.canvas.getBoundingClientRect();
            
            // Temizle
            this.canvasContext.fillStyle = '#f8fafc';
            this.canvasContext.fillRect(0, 0, width, height);
            
            // Dalga çiz
            this.canvasContext.lineWidth = 2;
            this.canvasContext.strokeStyle = '#08ca76ff';
            this.canvasContext.beginPath();
            
            const sliceWidth = width / bufferLength;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * height) / 2;
                
                if (i === 0) {
                    this.canvasContext.moveTo(x, y);
                } else {
                    this.canvasContext.lineTo(x, y);
                }
                
                x += sliceWidth;
            }
            
            this.canvasContext.lineTo(width, height / 2);
            this.canvasContext.stroke();
            
            // Ses seviyesini hesapla ve güncelle
            this._updateAudioLevel(dataArray);
        };
        
        draw();
    }

    /**
     * Ses seviye çubuğunu günceller
     * @private
     */
    _updateAudioLevel(dataArray) {
        // RMS (Root Mean Square) hesapla
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const normalized = (dataArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(100, rms * 200); // 0-100 arası normalize
        
        // DOM güncelleme (throttle ile optimize edilmiş)
        const indicator = document.getElementById('levelIndicator');
        if (indicator) {
            indicator.style.width = `${level}%`;
        }
    }

    /**
     * Mikrofonu sessize al/aç
     */
    toggleMute() {
        if (!this.localStream) {
            return false;
        }

        const audioTracks = this.localStream.getAudioTracks();
        
        if (audioTracks.length === 0) {
            return false;
        }

        this.isMuted = !this.isMuted;
        audioTracks.forEach(track => {
            track.enabled = !this.isMuted;
        });

        return this.isMuted;
    }

    /**
     * Ses akışını ve kaynakları temizle
     */
    cleanup() {
        // Animation'ı durdur
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Stream'i durdur
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // AudioContext'i kapat
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.analyser = null;
        this.microphone = null;
    }

    /**
     * Mikrofon durumunu kontrol et
     */
    getStatus() {
        return {
            isActive: this.localStream !== null,
            isMuted: this.isMuted,
            trackCount: this.localStream ? this.localStream.getAudioTracks().length : 0
        };
    }
}