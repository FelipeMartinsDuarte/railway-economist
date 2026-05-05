# Instruções de configuração (variáveis de ambiente)

Guia de **onde obter** cada valor e o que colocar no `.env` ou no painel do host (ex.: Railway).

> **Nunca** commite `.env` nem tokens. Use `.env.example` só como modelo.

---

## Telegram

| Variável | O que é | Como obter |
|----------|---------|------------|
| `TELEGRAM_BOT_TOKEN` | Token do bot | Telegram → [@BotFather](https://t.me/BotFather) → `/newbot` ou o bot que já tens → recebes o token no formato `123456:ABC...` |
| `TELEGRAM_ALLOWED_USER_IDS` | Quem pode usar `/up`, `/down`, `/check` | [@userinfobot](https://t.me/userinfobot) → copia o **Id** (só números). Vários separados por vírgula: `111111111,222222222` |

---

## URL do app (onde corre este Node)

| Variável | O que é |
|----------|---------|
| `PUBLIC_BASE_URL` | URL **HTTPS** **sem** barra no fim, por exemplo `https://nome-do-servico.up.railway.app` — domínio público do **serviço onde este bot está deployed**. |
| `WEBHOOK_PATH` | Caminho do webhook; podes deixar `/webhook`. O Telegram envia updates para `PUBLIC_BASE_URL` + `WEBHOOK_PATH`. |

### Webhook automático no arranque

Se **`PUBLIC_BASE_URL`** estiver definida, ao **subir a aplicação** o processo chama `setWebhook` na API do Telegram e regista `PUBLIC_BASE_URL` + `WEBHOOK_PATH`.

Se **`PUBLIC_BASE_URL`** estiver **vazia**, o webhook **não** é registado automaticamente — tens de configurá-lo manualmente (API do Telegram ou ferramentas equivalentes).

---

## Segurança extra (opcional)

| Variável | O que é |
|----------|---------|
| `TELEGRAM_WEBHOOK_SECRET` | Segredo à tua escolha (ex.: ~32 caracteres aleatórios). O Telegram envia no header `X-Telegram-Bot-Api-Secret-Token`; o app usa o mesmo valor no `setWebhook`. Vazio = funciona, com menos proteção. |
| `CORS_ORIGINS` | Só relevante se fores aceder à API a partir do **browser**. Para só Telegram + webhook, deixa **vazio**. Se precisares: `https://algum-site.com` ou `*` (menos restritivo). |

---

## Railway API

Usa **`RAILWAY_TOKEN`** **ou** **`RAILWAY_PROJECT_TOKEN`** — idealmente **apenas um** no `.env`.

Se **os dois** estiverem definidos, esta app usa **`RAILWAY_TOKEN`** (Bearer) e **ignora** o project token. Assim evitas `Not Authorized` por token antigo ou projeto errado misturado.

**Erro “Not Authorized” da Railway:** token revogado/expirado, `RAILWAY_PROJECT_ID` de outro projeto, ou credencial de tipo errado. Gera um token novo em [account/tokens](https://railway.com/account/tokens), confirma o **Project ID** (Ctrl+K no dashboard) e redeploy.

| Variável | O que é |
|----------|---------|
| `RAILWAY_PROJECT_TOKEN` | Token **escopado ao projeto** — Railway → projeto → **Settings** / **Tokens**, ou [account tokens](https://railway.com/account/tokens) conforme o tipo que criaste. Cola o valor que o painel mostra (regenera se tiveres exposto o antigo). |
| `RAILWAY_PROJECT_ID` | Com **project token**, muitas vezes podes **deixar vazio** — o código resolve via query `projectToken`. Se falhar: no Railway **Ctrl+K** → “Copy Project ID”. |
| `RAILWAY_ENVIRONMENT_ID` | Na maior parte dos casos **vazio** — o script usa o **environment base** do projeto. Preenche só se quiseres outro ambiente (ex.: staging): copia o ID no dashboard. |
| `RAILWAY_TOKEN` | Token de **conta ou workspace** — [railway.com/account/tokens](https://railway.com/account/tokens). Só necessário se **não** usares `RAILWAY_PROJECT_TOKEN`. |

---

## Ordem prática (checklist)

1. BotFather → token → `TELEGRAM_BOT_TOKEN`
2. userinfobot → Id → `TELEGRAM_ALLOWED_USER_IDS`
3. Depois do deploy deste serviço no Railway → domínio HTTPS → `PUBLIC_BASE_URL`
4. `WEBHOOK_PATH=/webhook` (padrão razoável)
5. Project token (novo, se revogaste outro) → `RAILWAY_PROJECT_TOKEN`
6. Na maior parte dos casos com project token: `RAILWAY_PROJECT_ID` e `RAILWAY_ENVIRONMENT_ID` **em branco**

---

## Menos variáveis no `.env`

Quem quiser pode ir reduzindo opcionais: deixa vazio o que o código trata por defeito (`WEBHOOK_PATH`, `CORS_ORIGINS`, IDs Railway quando o token de projeto já define escopo, etc.). O mínimo típico é: tokens Telegram + quem pode usar o bot + URL pública + credencial Railway.
