import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import Pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import express from 'express';
import fs from 'fs';
import path from 'path';

const logger = Pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);
const AUTH_TOKEN = process.env.AUTH_TOKEN || ''; // defina na Railway
const DATA_DIR = '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- Auth middleware ---------- */
function auth(req, res, next) {
  if (!AUTH_TOKEN) return res.status(500).json({ error: 'AUTH_TOKEN não configurado' });
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (t !== AUTH_TOKEN) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

/* ---------- Util ---------- */
let sockRef = { sock: null };
let lastQr = null;

function normalizeNumber(num) {
  let n = String(num).replace(/[^\d]/g, '');
  if (!n.endsWith('@s.whatsapp.net') && !n.endsWith('@g.us')) n = `${n}@s.whatsapp.net`;
  return n;
}

/* ---------- Baileys ---------- */
async function start() {
  try {
    const { version } = await fetchLatestBaileysVersion();
    logger.info({ version }, 'Usando versão do WhatsApp Web');

    const { state, saveCreds } = await useMultiFileAuthState(path.join(DATA_DIR, 'auth'));

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false, // vamos exibir via HTTP
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
        // guarda para a rota web e também mostra no log ASCII (opcional)
        lastQr = qr;
        qrcodeTerminal.generate(qr, { small: true });
        logger.info('QR atualizado — abra a página inicial para escanear.');
      }

      if (connection === 'open') logger.info('✅ Conectado!');
      if (connection === 'close') {
        const reason = lastDisconnect?.error?.message || 'desconhecido';
        logger.warn({ reason }, 'Conexão fechada, tentando reconectar…');
        // tenta reiniciar
        start().catch(err => logger.error({ err }, 'Erro ao reiniciar'));
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // ping simples
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
  } catch (err) {
    logger.error({ err }, 'Falha ao iniciar');
    // deixa o processo vivo para Railway reiniciar / healthcheck falhar
  }
}

start().catch(err => logger.error({ err }, 'Erro inesperado ao iniciar'));

/* ---------- Rotas HTTP ---------- */

// health
app.get('/health', (_req, res) => res.send('OK'));

// página com o QR
app.get('/', async (_req, res) => {
  try {
    if (!lastQr) return res.send('<h2>Aguardando geração do QR Code…</h2>');
    const dataUrl = await QRCode.toDataURL(lastQr);
    res.type('html').send(`
      <html><body style="text-align:center;font-family:sans-serif">
        <h2>Escaneie o QR Code para conectar</h2>
        <img src="${dataUrl}" alt="QR Code" />
      </body></html>
    `);
  } catch (err) {
    logger.error({ err }, 'Erro ao gerar QR');
    res.status(500).send('Erro ao gerar QR Code');
  }
});

// status de sessão (protegido)
app.get('/session', auth, (_req, res) => {
  res.json({ connected: !!sockRef.sock?.user, user: sockRef.sock?.user || null });
});

// enviar mensagem (protegido)
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
    logger.error({ e }, 'Falha no /send');
    res.status(500).json({ error: 'Falha ao enviar', detail: String(e?.message || e) });
  }
});

// apagar sessão e reiniciar (protegido)
app.post('/logout', auth, async (_req, res) => {
  try {
    if (sockRef.sock) await sockRef.sock.logout().catch(() => {});
    const authDir = path.join(DATA_DIR, 'auth');
    fs.rmSync(authDir, { recursive: true, force: true });
    lastQr = null;
    res.json({ ok: true, message: 'Sessão apagada. Serviço reiniciando…' });
    setTimeout(() => process.exit(0), 400);
  } catch (err) {
    logger.error({ err }, 'Erro no /logout');
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.listen(PORT, () => logger.info(`HTTP on :${PORT}`));
