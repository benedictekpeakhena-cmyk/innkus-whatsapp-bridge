const express = require('express');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());

let sock = null;
let qrCodeData = null;
let isConnected = false;
let messages = [];

const AUTH_FOLDER = './auth_info';

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();
    
    console.log(`Using Baileys v${version.join('.')}`);
    
    sock = makeWASocket({
        version,
        auth: state,
        browser: ['Innkus 2.0', 'Chrome', '1.0'],
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            console.log('QR Code generated! Visit /qr to scan.');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            isConnected = false;
            qrCodeData = null;
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp connected!');
            isConnected = true;
            qrCodeData = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            const text = msg.message?.conversation || 
                        msg.message?.extendedTextMessage?.text || 
                        msg.message?.imageMessage?.caption ||
                        '[media]';
            messages.push({
                from: msg.key.remoteJid,
                text: text,
                timestamp: new Date().toISOString()
            });
            console.log(`New message from ${msg.key.remoteJid}: ${text}`);
        }
    });
}

// API Endpoints
app.get('/', (req, res) => {
    res.json({ 
        status: isConnected ? 'connected' : 'disconnected', 
        messages: messages.length,
        qr_available: qrCodeData !== null
    });
});

app.get('/qr', async (req, res) => {
    if (!qrCodeData) {
        return res.json({ 
            qr: null, 
            message: isConnected ? 'Already connected!' : 'No QR code available yet. Wait a moment and refresh.' 
        });
    }
    
    try {
        // Generate QR code as data URL
        const qrDataUrl = await QRCode.toDataURL(qrCodeData, { width: 400 });
        res.json({ 
            qr: qrDataUrl,
            message: 'Scan this QR code with WhatsApp'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/qr-image', async (req, res) => {
    if (!qrCodeData) {
        return res.status(404).send('No QR code available');
    }
    
    try {
        const qrBuffer = await QRCode.toBuffer(qrCodeData, { width: 400 });
        res.setHeader('Content-Type', 'image/png');
        res.send(qrBuffer);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isConnected) return res.status(400).json({ error: 'WhatsApp not connected' });
    if (!number || !message) return res.status(400).json({ error: 'Need number and message' });
    
    try {
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
        const result = await sock.sendMessage(jid, { text: message });
        res.json({ success: true, sent: { to: number, message }, id: result.key.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/messages', (req, res) => {
    res.json({ messages: messages.slice(-50) }); // Last 50 messages
});

app.post('/clear', (req, res) => {
    messages = [];
    res.json({ cleared: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`WhatsApp Bridge running on port ${PORT}`);
    console.log(`QR Code URL: http://localhost:${PORT}/qr-image`);
    startWhatsApp();
});

