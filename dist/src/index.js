import { Bot } from "grammy";
import { config } from "./config.js";
import { registerCommands } from "./bot/handlers/cmd.js";
const token = config.bot.token;
if (!token) {
    throw new Error("bot-token is not defined");
}
// bot initialization
const bot = new Bot(token);
registerCommands(bot);
// end
bot.start();
