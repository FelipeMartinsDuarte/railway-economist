function trim(v, fallback = "") {
  return String(process.env[v] ?? fallback).trim();
}

export function loadConfig() {
  const port = Number(trim("PORT", "3000")) || 3000;
  const rawWebhook = trim("WEBHOOK_PATH", "/webhook") || "/webhook";
  const webhookPath = rawWebhook.startsWith("/") ? rawWebhook : `/${rawWebhook}`;
  return {
    port,
    telegramToken: trim("TELEGRAM_BOT_TOKEN"),
    publicBaseUrl: trim("PUBLIC_BASE_URL").replace(/\/$/, ""),
    webhookPath,
    webhookSecret: trim("TELEGRAM_WEBHOOK_SECRET"),
    corsOrigins: trim("CORS_ORIGINS"),
  };
}
