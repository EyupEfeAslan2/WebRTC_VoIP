# WebRTC VoIP Prototype

Bu proje, Turkcell VoIP ekibi staj çalışması kapsamında geliştirilmektedir.
Ana hedef, **WebRTC** teknolojisini kullanarak düşük gecikmeli, yüksek kaliteli ve güvenli **gerçek zamanlı ses aktarımı (VoIP)** sağlayan bir web uygulaması geliştirmektir.

## Proje Hedefleri
Proje, karmaşıklık yerine **stabilite ve ses kalitesine** odaklanmaktadır.
1.  **Öncelik (Core):** 1'e 1 (P2P) Kesintisiz Ses Görüşmesi.
2.  **İkincil (Scale):** Mesh Mimarisi ile Çoklu Sesli Konferans.
3.  **Yan Hedef (Feature):** Görüntü Aktarımı (Video).
4.  **Analiz (Monitor):** Ağ İstatistikleri (Bitrate, Packet Loss) Paneli.

## Teknoloji Yığını
* **OS:** Fedora Linux
* **Backend / Signaling:** Node.js, Express, Socket.io
* **Frontend:** Vanilla JavaScript, HTML5, CSS3
* **Protocol:** WebRTC (UDP/TCP, SRTP, DTLS)

## Geliştirme Yol Haritası (4 Hafta)
- [ ] **Hafta 1:** Ortam kurulumu, Signaling Server (Socket.io) ve 1:1 Ses Bağlantısı.
- [ ] **Hafta 2:** NAT Traversal (STUN/TURN) entegrasyonu ve ağ testleri.
- [ ] **Hafta 3:** Çoklu kullanıcı (Multi-peer) ses odası mantığı.
- [ ] **Hafta 4:** Görüntü entegrasyonu ve ağ analiz dashboard'u.

---