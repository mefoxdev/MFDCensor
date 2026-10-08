import { Bot } from "grammy"
import { config } from "./config.js"
import { MeContext } from "../types.js"
import { registerCommands } from "./bot/handlers/cmd.js"

const token = config.bot.token
if (!token) {
  throw new Error("bot-token is not defined")
}

// bot initialization
const bot = new Bot<MeContext>(token)

registerCommands(bot)

// end
bot.start()
