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

const logger = Pino({ level: 'info' });
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ====== AUTH POR TOKEN (Bearer) ======
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
function authMiddleware(req, res, next) {
  if (!AUTH_TOKEN) return res.status(500).json({ error: 'AUTH_TOKEN não configurado' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// ====== HEALTHCHECK / KEEP-ALIVE ======
app.get('/health', (_, res) => res.status(200).send('OK'));

// ====== PASTA PARA SESSÃO (persistente via Volume) ======
const DATA_DIR = '/app/data'; // Monte um Volume aqui na Railway
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let sockRef = { sock: null };

function normalizeNumber(num) {
  let n = String(num).trim();
  n = n.replace(/[^\d]/g, '');
  if (!n.endsWith('@s.whatsapp.net') && !n.endsWith('@g.us')) {
    n = `${n}@s.whatsapp.net`;
  }
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

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      logger.info('Escaneie o QR abaixo para conectar:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const reason =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.message ||
        'desconhecido';
      logger.warn({ reason }, 'Conexão fechada, tentando reconectar...');
      start().catch(err => logger.error({ err }, 'Erro ao reiniciar socket'));
    } else if (connection === 'open') {
      logger.info('✅ Conectado ao WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages?.[0];
      if (!msg?.key?.remoteJid || msg.key.fromMe) return;
      const from = msg.key.remoteJid;
      const body =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';

      if (body?.trim().toLowerCase() === 'ping') {
        await sock.sendMessage(from, { text: 'pong ✅' });
      }
    } catch (err) {
      logger.error({ err }, 'Erro no handler de mensagem');
    }
  });
}

start().catch(err => logger.error({ err }, 'Falha ao iniciar'));

// ========= ROTAS HTTP =========
app.post('/send', authMiddleware, async (req, res) => {
  try {
    const sock = sockRef.sock;
    if (!sock) return res.status(503).json({ error: 'Socket ainda não está pronto' });

    const { to, type = 'text', message, url, filename, caption } = req.body || {};
    if (!to) return res.status(400).json({ error: '"to" é obrigatório' });

    const jid = normalizeNumber(to);

    let payload = null;
    switch (type) {
      case 'text':
        if (!message) return res.status(400).json({ error: '"message" é obrigatório para type=text' });
        payload = { text: message };
        break;
      case 'image':
        if (!url) return res.status(400).json({ error: '"url" é obrigatório para type=image' });
        payload = { image: { url }, caption };
        break;
      case 'video':
        if (!url) return res.status(400).json({ error: '"url" é obrigatório para type=video' });
        payload = { video: { url }, caption };
        break;
      case 'audio':
        if (!url) return res.status(400).json({ error: '"url" é obrigatório para type=audio' });
        payload = { audio: { url }, mimetype: 'audio/mpeg' };
        break;
      case 'document':
        if (!url) return res.status(400).json({ error: '"url" é obrigatório para type=document' });
        payload = { document: { url }, fileName: filename || 'arquivo', caption };
        break;
      default:
        return res.status(400).json({ error: `type inválido: ${type}` });
    }

    const result = await sock.sendMessage(jid, payload);
    return res.json({ ok: true, jid, type, id: result?.key?.id || null });
  } catch (err) {
    logger.error({ err }, 'Erro no /send');
    return res.status(500).json({ error: 'Falha ao enviar mensagem', detail: String(err?.message || err) });
  }
});

app.get('/session', authMiddleware, async (_req, res) => {
  const connected = !!sockRef.sock?.user;
  res.json({
    connected,
    user: sockRef.sock?.user || null
  });
});

app.listen(PORT, () => {
  logger.info(`HTTP server on :${PORT}`);
});
