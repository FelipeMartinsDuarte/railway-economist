import { parseAllowedUserIds, isAllowedUser } from "../services/access.js";
import { runCheckAll, runDownAll, runUpAll } from "../services/economist.js";

function safeReplyErr(e) {
  const m = String(e?.message || e);
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}

export function registerCommands(bot) {
  const allowed = parseAllowedUserIds();

  bot.command("up", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    try {
      await ctx.reply(await runUpAll());
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });

  bot.command("down", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    try {
      await ctx.reply(await runDownAll());
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });

  bot.command("check", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    try {
      await ctx.reply(await runCheckAll());
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });
}
