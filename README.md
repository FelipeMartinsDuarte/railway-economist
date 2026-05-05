# RAILWAY ECONOMIST

Bot no Telegram que ajuda a **economizar** no Railway ao **parar todos os deployments** de um projeto quando você não precisa deles rodando e **subir de novo** quando precisar. Não remove serviços, volumes nem configuração — só usa a API pública para `deploymentStop` e `deploymentRestart` por serviço.

**→ Guia passo a passo das variáveis de ambiente: [instructions.md](instructions.md)**

## Como funciona

1. Você hospeda este app (por exemplo no próprio Railway) com HTTPS.
2. Com `PUBLIC_BASE_URL` definida, ao **iniciar** o app regista o **webhook** no Telegram (ver instruções de como obter em [instructions.md](instructions.md)).
3. Com um token da API do Railway, o app lista os serviços do projeto, lê o último deployment de cada um e aplica parar ou reiniciar conforme o comando.
4. Só usuários cujo **ID do Telegram** está em `TELEGRAM_ALLOWED_USER_IDS` conseguem usar os comandos.

### Comandos

| Comando  | Ação |
|----------|------|
| `/down`  | Para o último deployment de cada serviço (`deploymentStop`). |
| `/up`    | Reinicia esses deployments (`deploymentRestart`). |
| `/check` | Mostra status do último deployment por serviço. |

O Telegram continua usando `/start` para conversar com o bot; os fluxos acima são **`/up`**, **`/down`** e **`/check`** para não conflitar.

## Configuração rápida

Copie `.env.example` para `.env` (ou defina as variáveis no painel do host). Lista completa e onde obter cada valor: **[instructions.md](instructions.md)**.

```bash
npm install
npm start
```

`GET /health` responde `{"ok":true}` para health check.

## Segurança e repositório público

- Limite quem pode usar o bot com `TELEGRAM_ALLOWED_USER_IDS`.
- Opcional: `TELEGRAM_WEBHOOK_SECRET` (ver [instructions.md](instructions.md)).

## Licença

Use e adapte como quiser; mantenha os tokens seguros.
