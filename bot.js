import { Telegraf, Markup } from "telegraf";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("BOT_TOKEN is missing. Create .env (or set env var) with BOT_TOKEN=....");
  process.exit(1);
}

const WEBAPP_URL = process.env.WEBAPP_URL || "http://localhost:3000";

const bot = new Telegraf(token);

bot.start(async (ctx) => {
  const text =
    "🎩 ЩляпКликер\n\n" +
    "1) Открой мини‑приложение (кликер + колесо)\n" +
    "2) Или загрузи повязку (скоро)\n\n" +
    "ℹ️ Для теста: вводишь ник — скин грузится автоматически.";
  await ctx.reply(
    text,
    Markup.inlineKeyboard([
      [Markup.button.webApp("Открыть Mini App", WEBAPP_URL)],
      [Markup.button.callback("Загрузить повязку (скоро)", "UPLOAD_BAND")]
    ])
  );
});

bot.action("UPLOAD_BAND", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("🧪 В тестовой версии загрузка повязок ещё не включена. Скоро добавим /upload_band для админов.");
});

bot.on("text", async (ctx) => {
  const t = ctx.message.text?.trim();
  if (t === "/help") {
    await ctx.reply("Команды:\n/start — кнопка Mini App\n/help — помощь");
  }
});

bot.launch().then(() => {
  console.log(`[bot] launched. WEBAPP_URL=${WEBAPP_URL}`);
});

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
