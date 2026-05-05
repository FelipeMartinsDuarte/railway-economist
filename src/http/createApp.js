import cors from "cors";
import express from "express";

export function createApp(bot, config) {
  const app = express();
  const corsOptions = {
    origin: (origin, cb) => {
      const allowList = config.corsOrigins
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!origin || allowList.length === 0 || allowList.includes("*")) {
        cb(null, true);
        return;
      }
      if (allowList.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Telegram-Bot-Api-Secret-Token",
    ],
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use(express.json({ limit: "2mb" }));

  app.use((req, res, next) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    const p = req.path.split("?")[0];
    if (p !== config.webhookPath) {
      next();
      return;
    }
    if (config.webhookSecret) {
      const t = req.get("X-Telegram-Bot-Api-Secret-Token");
      if (t !== config.webhookSecret) {
        res.sendStatus(403);
        return;
      }
    }
    next();
  });

  app.use(bot.webhookCallback(config.webhookPath));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
