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
- [ ] Ortam kurulumu, Signaling Server (Socket.io) ve 1:1 Ses Bağlantısı.  //Bitti
- [ ] Çoklu kullanıcı (Multi-peer) ses odası mantığı.  //Bitti
    Odalara şifreleme mantığı getirelecek.Hash kullanmayı düşünüyorum.
    
- [ ] Görüntü entegrasyonu ve ekran paylaşımı
- [ ] Kullanıcılara nickname seçim hakkı verilmesi ve 1:1 aramalar yapılması (Accept/Decline)
---