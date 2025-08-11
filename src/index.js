import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import Pino from 'pino';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';


const logger = Pino({ level: 'info' });
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// token bearer
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
function auth(req, res, next) {
  if (!AUTH_TOKEN) return res.status(500).json({ error: 'AUTH_TOKEN não configurado' });
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (t !== AUTH_TOKEN) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// saúde
app.get('/health', (_, res) => res.send('OK'));

// sessão persistida
const DATA_DIR = '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sockRef = { sock: null };
let lastQr = null;


function normalizeNumber(num) {
  let n = String(num).replace(/[^\d]/g, '');
  if (!n.endsWith('@s.whatsapp.net') && !n.endsWith('@g.us')) n = `${n}@s.whatsapp.net`;
  return n;
}

async function start() {
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, 'Usando versão do WhatsApp Web');

  const { state, saveCreds } = await useMultiFileAuthState(path.join(DATA_DIR, 'auth'));
  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    syncFullHistory: false,
    browser: ['Railway-Bot', 'Chrome', '121'],
    markOnlineOnConnect: true
  });

  sockRef.sock = sock;

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info('Escaneie o QR abaixo:');
              lastQr = qr;
      
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      logger.warn({ reason: lastDisconnect?.error?.message }, 'Reconectando…');
      start().catch(err => logger.error({ err }, 'Erro ao reiniciar'));
    }
    if (connection === 'open') logger.info('✅ Conectado!');
  });

  sock.ev.on('creds.update', saveCreds);

  // echo de teste
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0];
    if (!msg?.key?.remoteJid || msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption || '';

    if (body.trim().toLowerCase() === 'ping') {
      await sock.sendMessage(from, { text: 'pong ✅' });
    }
  });
}
start().catch(err => logger.error({ err }, 'Falha ao iniciar'));

// API /send
app.post('/send', auth, async (req, res) => {
  try {
    const sock = sockRef.sock;
    if (!sock) return res.status(503).json({ error: 'Socket não pronto' });
    const { to, type = 'text', message, url, filename, caption } = req.body || {};
    if (!to) return res.status(400).json({ error: '"to" é obrigatório' });
    const jid = normalizeNumber(to);

    let payload;
    if (type === 'text') {
      if (!message) return res.status(400).json({ error: '"message" é obrigatório' });
      payload = { text: message };
    } else if (type === 'image') {
      if (!url) return res.status(400).json({ error: '"url" é obrigatório' });
      payload = { image: { url }, caption };
    } else if (type === 'video') {
      if (!url) return res.status(400).json({ error: '"url" é obrigatório' });
      payload = { video: { url }, caption };
    } else if (type === 'audio') {
      if (!url) return res.status(400).json({ error: '"url" é obrigatório' });
      payload = { audio: { url }, mimetype: 'audio/mpeg' };
    } else if (type === 'document') {
      if (!url) return res.status(400).json({ error: '"url" é obrigatório' });
      payload = { document: { url }, fileName: filename || 'arquivo', caption };
    } else {
      return res.status(400).json({ error: `type inválido: ${type}` });
    }

    const result = await sock.sendMessage(jid, payload);
    res.json({ ok: true, jid, type, id: result?.key?.id || null });
  } catch (e) {
    res.status(500).json({ error: 'Falha ao enviar', detail: String(e?.message || e) });
  }
});


app.get('/', async (req, res) => {
  try {
    if (!lastQr) {
      return res.send('<h2>Aguardando geração do QR Code…</h2>');
    }
    const dataUrl = await QRCode.toDataURL(lastQr);
    return res.send('<html><body><h2>Escaneie o QR Code para conectar</h2><img src="' + dataUrl + '" alt="QR Code"></body></html>');
  } catch (err) {
    return res.status(500).send('Erro ao gerar QR Code');
  }
});

// status
app.get('/session', auth, (_req, res) => {
  res.json({ connected: !!sockRef.sock?.user, user: sockRef.sock?.user || null });
});

app.post('/logout', auth, async (_req, res) => {
  try {
    if (sockRef.sock) await sockRef.sock.logout().catch(() => {});
    const authDir = path.join(DATA_DIR, 'auth');
    fs.rmSync(authDir, { recursive: true, force: true });
    lastQr = null;
    res.json({ ok: true, message: 'Sessão apagada. Reinicie o serviço para gerar novo QR.' });
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, () => logger.info(`HTTP on :${PORT}`));
