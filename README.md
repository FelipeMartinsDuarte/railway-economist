# RAILWAY ECONOMIST

Bot no Telegram que ajuda a **economizar** no Railway ao **parar todos os deployments** de um projeto quando você não precisa deles rodando e **subir de novo** quando precisar. Não remove serviços, volumes nem configuração — usa a API pública (`deploymentCancel` / `deploymentStop`, `deploymentRestart` / `deploymentRedeploy`).

**→ Guia passo a passo das variáveis de ambiente: [instructions.md](instructions.md)**

## Como funciona

1. Você hospeda este app (por exemplo no próprio Railway) com HTTPS.
2. Com `PUBLIC_BASE_URL` definida, ao **iniciar** o app regista o **webhook** no Telegram (ver instruções de como obter em [instructions.md](instructions.md)).
3. Com um token da API do Railway, o app lista os serviços do projeto, lê deployments ativos e aplica parar ou reiniciar conforme o comando.
4. Só usuários cujo **ID do Telegram** está em `TELEGRAM_ALLOWED_USER_IDS` conseguem usar os comandos.

### Comandos

| Comando  | Ação |
|----------|------|
| `/down`  | Cancela **em paralelo** todos os deployments ativos (`deploymentCancel`; fallback `deploymentStop`), com várias passadas de retry. |
| `/up`    | Sobe de novo (`deploymentRestart`, com fallback `deploymentRedeploy`). |
| `/check` | Mostra status do deployment ativo por serviço. |

O `/down` **não desliga o próprio bot** por padrão (usa `RAILWAY_SERVICE_ID` / nome injetados pelo Railway). Assim o processo não morre no meio e consegue parar o restante. Para forçar parar o bot no fim: `RAILWAY_STOP_SELF=1`.

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
