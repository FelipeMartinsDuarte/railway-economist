import { Telegraf } from "telegraf";

import { registerCommands } from "./src/bot/registerCommands.js";
import { loadConfig } from "./src/config.js";
import { createApp } from "./src/http/createApp.js";

const config = loadConfig();

if (!config.telegramToken) {
  console.error("Set TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const bot = new Telegraf(config.telegramToken);
registerCommands(bot);

const app = createApp(bot, config);

const server = app.listen(config.port, async () => {
  console.log(`HTTP :${config.port} POST ${config.webhookPath}`);

  if (config.publicBaseUrl) {
    const url = `${config.publicBaseUrl}${config.webhookPath}`;
    try {
      await bot.telegram.setWebhook(url, {
        allowed_updates: ["message", "callback_query"],
        secret_token: config.webhookSecret || undefined,
      });
      console.log(`Webhook: ${url}`);
    } catch (e) {
      console.error("Webhook:", e?.message || e);
    }
  } else {
    console.warn("PUBLIC_BASE_URL unset — register the webhook manually.");
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
