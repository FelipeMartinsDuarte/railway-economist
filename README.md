# RAILWAY ECONOMIST

Bot no Telegram que ajuda a **economizar** no Railway ao **parar todos os deployments** de um projeto quando você não precisa deles rodando e **subir de novo** quando precisar. Não remove serviços, volumes nem configuração — só usa a API pública para `deploymentStop` e `deploymentRestart` por serviço.

## Como funciona

1. Você hospeda este app (por exemplo no próprio Railway) com HTTPS.
2. O app registra um **webhook** do Telegram e escuta comandos.
3. Com um token da API do Railway, o app lista os serviços do projeto, lê o último deployment de cada um e aplica parar ou reiniciar conforme o comando.
4. Só usuários cujo **ID do Telegram** está em `TELEGRAM_ALLOWED_USER_IDS` conseguem usar os comandos.

### Comandos

| Comando  | Ação |
|----------|------|
| `/down`  | Para o último deployment de cada serviço (`deploymentStop`). |
| `/up`    | Reinicia esses deployments (`deploymentRestart`). |
| `/check` | Mostra status do último deployment por serviço. |

O Telegram continua usando `/start` para conversar com o bot; os fluxos acima são **`/up`**, **`/down`** e **`/check`** para não conflitar.

## Configuração

Copie `.env.example` para `.env` (ou defina as variáveis no painel do host) e preencha:

- **Telegram:** `TELEGRAM_BOT_TOKEN` (BotFather), `TELEGRAM_ALLOWED_USER_IDS`, `PUBLIC_BASE_URL` (URL pública do app, sem barra no final), `WEBHOOK_PATH` (ex.: `/webhook`), opcional `TELEGRAM_WEBHOOK_SECRET` e `CORS_ORIGINS`.
- **Railway:** `RAILWAY_TOKEN` *ou* `RAILWAY_PROJECT_TOKEN`, `RAILWAY_PROJECT_ID` se necessário, opcional `RAILWAY_ENVIRONMENT_ID`.

Instalação e execução:

```bash
npm install
npm start
```

`GET /health` responde `{"ok":true}` para health check.

