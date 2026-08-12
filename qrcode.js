// ============================================
// QR CODE GENERATOR — qrcode.js
// ============================================

console.log('[QR-GENERATOR] qrcode.js loaded');

// State
let currentQrContainer = null;
let currentQrCanvas = null;
let currentQrImage = null;
let currentToken = '';

// ============================================
// CEK LIBRARY
// ============================================
function isQrCodeLibraryAvailable() {
    const available = typeof QRCode !== 'undefined';
    console.log('[QR-GENERATOR] QRCode.js available:', available);
    return available;
}

// ============================================
// GENERATE QR
// ============================================
function generateQR(token, containerId) {
    console.log('[QR-GENERATOR] generateQR() called');
    console.log('[QR-GENERATOR] Token:', token);
    
    const container = document.getElementById(containerId);
    if (!container) {
        console.error('[QR-GENERATOR] Container not found:', containerId);
        return false;
    }
    
    if (!isQrCodeLibraryAvailable()) {
        console.error('[QR-GENERATOR] QRCode.js not available');
        container.innerHTML = '<p style="color:#dc3545;">❌ QRCode.js belum tersedia. Silakan reload halaman.</p>';
        return false;
    }
    
    // Bersihkan container
    container.innerHTML = '';
    currentQrContainer = container;
    currentQrCanvas = null;
    currentQrImage = null;
    currentToken = token || 'qrmvp2026';
    
    try {
        // Generate QR Code
        const qr = new QRCode(container, {
            text: currentToken,
            width: 300,
            height: 300,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
        
        console.log('[QR-GENERATOR] QR generated successfully');
        
        // Cari canvas atau img yang dihasilkan
        const canvas = container.querySelector('canvas');
        const img = container.querySelector('img');
        
        if (canvas) {
            currentQrCanvas = canvas;
            console.log('[QR-GENERATOR] QR rendered as canvas');
        } else if (img) {
            currentQrImage = img;
            console.log('[QR-GENERATOR] QR rendered as img');
        }
        
        // Tampilkan token di bawah QR
        const tokenDisplay = document.getElementById('qrTokenDisplay');
        if (tokenDisplay) {
            tokenDisplay.textContent = '📋 Token: ' + currentToken;
            tokenDisplay.style.color = '#28a745';
        }
        
        // Update status
        const statusMsg = document.getElementById('qrStatusMessage');
        if (statusMsg) {
            statusMsg.style.display = 'block';
            statusMsg.textContent = '✅ QR berhasil dibuat dengan token: ' + currentToken;
            statusMsg.className = 'success';
        }
        
        return true;
        
    } catch (error) {
        console.error('[QR-GENERATOR] Error generating QR:', error);
        container.innerHTML = '<p style="color:#dc3545;">❌ Gagal membuat QR: ' + (error.message || 'Unknown error') + '</p>';
        return false;
    }
}

// ============================================
// DOWNLOAD QR AS PNG
// ============================================
function downloadQR() {
    console.log('[QR-GENERATOR] downloadQR() called');
    
    if (!currentQrContainer) {
        alert('QR belum dibuat. Silakan generate QR terlebih dahulu.');
        return;
    }
    
    // Cari canvas atau img
    const canvas = currentQrContainer.querySelector('canvas');
    const img = currentQrContainer.querySelector('img');
    
    let imageData = null;
    
    if (canvas) {
        imageData = canvas.toDataURL('image/png');
        console.log('[QR-GENERATOR] QR converted from canvas to PNG');
    } else if (img) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.naturalWidth || 300;
        tempCanvas.height = img.naturalHeight || 300;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
        imageData = tempCanvas.toDataURL('image/png');
        console.log('[QR-GENERATOR] QR converted from img to PNG');
    } else {
        alert('Tidak dapat menemukan QR. Silakan generate ulang.');
        return;
    }
    
    if (!imageData) {
        alert('Gagal membuat gambar QR.');
        return;
    }
    
    // Buat link download
    const link = document.createElement('a');
    link.download = 'qr-absensi-qrmvp2026.png';
    link.href = imageData;
    link.click();
    
    console.log('[QR-GENERATOR] QR downloaded successfully');
}

// ============================================
// PRINT QR
// ============================================
function printQR() {
    console.log('[QR-GENERATOR] printQR() called');
    
    if (!currentQrContainer) {
        alert('QR belum dibuat. Silakan generate QR terlebih dahulu.');
        return;
    }
    
    const canvas = currentQrContainer.querySelector('canvas');
    const img = currentQrContainer.querySelector('img');
    let qrElement = canvas || img;
    
    if (!qrElement) {
        alert('Tidak dapat menemukan QR. Silakan generate ulang.');
        return;
    }
    
    const printWindow = window.open('', '_blank', 'width=500,height=600');
    if (!printWindow) {
        alert('Popup diblokir. Izinkan popup untuk print.');
        return;
    }
    
    let imageSrc = '';
    if (canvas) {
        imageSrc = canvas.toDataURL('image/png');
    } else if (img) {
        if (img.src && img.src.startsWith('data:')) {
            imageSrc = img.src;
        } else {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.naturalWidth || 300;
            tempCanvas.height = img.naturalHeight || 300;
            const ctx = tempCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
            imageSrc = tempCanvas.toDataURL('image/png');
        }
    }
    
    if (!imageSrc) {
        alert('Gagal menyiapkan gambar QR untuk print.');
        printWindow.close();
        return;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Print QR Absensi</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    padding: 20px;
                    background: white;
                }
                .qr-container {
                    text-align: center;
                    padding: 40px;
                    border: 2px solid #333;
                    border-radius: 8px;
                    background: white;
                }
                .qr-container h2 {
                    margin-top: 0;
                    color: #333;
                    font-size: 24px;
                }
                .qr-container img {
                    max-width: 300px;
                    max-height: 300px;
                    display: block;
                    margin: 20px auto;
                }
                .qr-container .token {
                    font-size: 18px;
                    color: #555;
                    margin-top: 16px;
                    padding: 8px 16px;
                    background: #f5f5f5;
                    border-radius: 4px;
                    display: inline-block;
                }
                .qr-container .footer {
                    margin-top: 20px;
                    font-size: 12px;
                    color: #999;
                    border-top: 1px solid #ddd;
                    padding-top: 12px;
                }
                @media print {
                    body { padding: 0; margin: 0; }
                    .qr-container { border: none; padding: 20px; }
                }
            </style>
        </head>
        <body>
            <div class="qr-container">
                <h2>📷 QR ABSENSI</h2>
                <img src="${imageSrc}" alt="QR Code" />
                <div class="token">Token: ${currentToken}</div>
                <div class="footer">Sistem Absensi Sekolah</div>
            </div>
            <script>
                window.onload = function() {
                    window.print();
                    window.close();
                };
            <\/script>
        </body>
        </html>
    `);
    
    printWindow.document.close();
    console.log('[QR-GENERATOR] Print dialog opened');
}

// ============================================
// EXPOSE FUNCTIONS KE GLOBAL
// ============================================
window.generateQR = generateQR;
window.downloadQR = downloadQR;
window.printQR = printQR;
window.isQrCodeLibraryAvailable = isQrCodeLibraryAvailable;

console.log('[QR-GENERATOR] qrcode.js ready');
console.log('[QR-GENERATOR] Available functions: generateQR(), downloadQR(), printQR()');