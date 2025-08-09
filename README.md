# Bot WhatsApp com Baileys para Railway

Este repositório contém um bot de WhatsApp baseado na biblioteca **Baileys** pronto para ser implantado na Railway.

## Como usar

1. **Envie este projeto para o seu GitHub.**
2. Clique no botão abaixo para criar um projeto na Railway a partir do seu repositório:

   [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new?template=https://github.com/leandro1205/leandrowhatsapp&envs=PORT,AUTH_TOKEN&PORTDefault=3000&AUTH_TOKENDesc=Token%20Bearer%20para%20proteger%20a%20API)

   - O botão acima está configurado para o repositório [`leandro1205/leandrowhatsapp`](https://github.com/leandro1205/leandrowhatsapp). Se você usar outro repositório, ajuste a URL na opção `template=`.
   - Na tela de deploy, defina `AUTH_TOKEN` com o valor que desejar (ex.: `leandro123`). `PORT` já vem com valor padrão `3000`.
3. Após o deploy, crie um **volume** montado em `/app/data` para persistir a sessão do WhatsApp.
4. Abra os **logs** do serviço na Railway e escaneie o QR code exibido para conectar a conta do WhatsApp.

## Endpoints disponíveis

- `GET /health` — verifica o status da aplicação.
- `GET /session` — retorna o status da sessão (requer o header `Authorization: Bearer <seu token>`).
- `POST /send` — envia mensagens de texto ou mídia (requer o header `Authorization: Bearer <seu token>`).

## Observações

- Este bot usa uma API não oficial (protocolo do WhatsApp Web), portanto utilize com responsabilidade. Existe risco de bloqueio da conta caso sejam enviados spams ou mensagens em massa.
- Não comite a pasta de credenciais (`/app/data`) nem o valor do `AUTH_TOKEN` no seu repositório. Essas informações devem permanecer apenas na Railway.
