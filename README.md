# WhatsApp Bot (Baileys) — Deploy automático na Railway

Bot WhatsApp usando Baileys + Express, com:
- Reconexão automática
- Sessão persistida em Volume (`/app/data`)
- Endpoint HTTP `/send` com Bearer Token
- Healthcheck `/health`

## Variáveis de Ambiente (Railway)
- `PORT=3000`
- `AUTH_TOKEN=leandro123` (troque por um segredo seu)

## Rotas
- `GET /health` — healthcheck
- `GET /session` — status da sessão (requer Bearer)
- `POST /send` — envia mensagens (requer Bearer)

### POST /send (JSON)
```json
{
  "to": "55719SEUNUMERO",
  "type": "text | image | video | audio | document",
  "message": "Olá",
  "url": "https://... (para mídia)",
  "filename": "arquivo.pdf",
  "caption": "legenda opcional"
}
```

## Como usar
1. Crie um projeto na Railway e selecione Deploy via **Dockerfile**.
2. Crie um **Volume** e monte em `/app/data`.
3. Defina as variáveis de ambiente (PORT, AUTH_TOKEN).
4. Faça o deploy e abra os **Logs**.
5. Escaneie o **QR code** no WhatsApp > **Aparelhos Conectados**.
6. Pronto!

> Observação: uso não-oficial do WhatsApp Web, evite spam para não arriscar bloqueios.
