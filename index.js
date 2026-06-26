const express = require('express');
const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode-terminal');

const app = express();
app.use(express.json());

let sock = null;
let qrCode = null;
let isConnected = false;
let messages = [];

const AUTH_FOLDER = './auth_info';

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCode = qr;
            console.log('QR Code generated! Visit /qr to see it.');
            QRCode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            isConnected = false;
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp connected!');
            isConnected = true;
            qrCode = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe) {
            messages.push({
                from: msg.key.remoteJid,
                text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[media]',
                timestamp: new Date().toISOString()
            });
        }
    });
}

// API Endpoints
app.get('/', (req, res) => {
    res.json({ status: isConnected ? 'connected' : 'disconnected', messages: messages.length });
});

app.get('/qr', (req, res) => {
    if (!qrCode) {
        return res.json({ qr: null, message: isConnected ? 'Already connected!' : 'No QR code available. Restarting...' });
    }
    res.json({ qr: qrCode });
});

app.post('/send', async (req, res) => {
    const { number, message } = req.body;
    if (!isConnected) return res.status(400).json({ error: 'WhatsApp not connected' });
    if (!number || !message) return res.status(400).json({ error: 'Need number and message' });
    
    try {
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, sent: { to: number, message } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/messages', (req, res) => {
    res.json({ messages });
});

app.post('/clear', (req, res) => {
    messages = [];
    res.json({ cleared: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`WhatsApp Bridge running on port ${PORT}`);
    startWhatsApp();
});

