import type { Bot } from "grammy"
import type { MeContext } from "../../../types.js"
import { config } from "../../config.js"
import { getPermission, type Permission } from "../../lib/censor-proto.js"
import { getChatSettings, getLatestBanCause, recordBan, setCaptchaMode, setCaptchaTopic, type CaptchaMode } from "../../lib/chat-settings.js"
import { registerJoinCaptcha } from "./captcha.js"

const familyLevel: Record<Permission["family"], number> = { A: 0, DV: 1, DI: 2, M: 3 }

async function requirePermission(ctx: MeContext, minimum: Permission): Promise<boolean> {
  const tgid = ctx.from?.id
  if (tgid === undefined) {
    return false
  }
  if (String(tgid) === String(config.OwnerInfo.OwnerID)) {
    return true
  }

  try {
    const permission = await getPermission({ tgid })
    const allowed = familyLevel[permission.family] >= familyLevel[minimum.family] && permission.rank >= minimum.rank
    if (!allowed) await ctx.reply(`[denied]\nrequired role A3, you have ${permission.family}${permission.rank}!`)
    return allowed
  } catch (error) {
    console.error("permission check failed", error)
    await ctx.reply("[denied]\npermission check failed, escalate this message to the owner or support", {
      reply_parameters: ctx.msg ? { message_id: ctx.msg.message_id } : undefined,
    })
    return false
  }
}

export function registerCommands(bot: Bot<MeContext>): void {
  bot.command('start', cmdStart)
  bot.command('help', cmdHelp)
  bot.command('support', cmdSupport)
  bot.command('privacy', cmdPrivacy)
  bot.command('ban', cmdBan)
  bot.command('info', cmdInfo)
  bot.command('set', cmdSet)
  registerJoinCaptcha(bot)
}

async function cmdStart(ctx: MeContext): Promise<void> {
  await ctx.reply("Hi\\! This bot belongs to the [MFDCommunity](https://telegram.me/MFDCommunity)", {
    parse_mode: 'MarkdownV2'
  })
}

// TODO: /support, /privacy

async function cmdHelp(ctx: MeContext): Promise<void> {
  await ctx.reply(`
    commands list:
  \\- /start \\- restart the bot
  \\- /help \\- show this help message
  \\- /support \\- contact support
  \\- /privacy \\- show privacy policy
    `, {
      parse_mode: 'MarkdownV2',
  })
}

async function cmdSupport(ctx: MeContext): Promise<void> {
  await ctx.reply('Contacts in bot\'s bio')
}

async function cmdPrivacy(ctx: MeContext): Promise<void> {
  await ctx.reply('Your rights comply with GDPR')
}

function parseBanUntilDate(literal: string | undefined): number | undefined {
  const now = new Date()
  if (literal === undefined) {
    const date = new Date(now)
    date.setUTCMonth(date.getUTCMonth() + 6)
    return Math.floor(date.getTime() / 1000)
  }

  const match = /^(\d+)(mo|w|d|h|m)$/i.exec(literal)
  if (!match) return undefined

  const amount = Number(match[1])
  if (!Number.isSafeInteger(amount) || amount < 1) return undefined

  const date = new Date(now)
  const unit = match[2].toLowerCase()
  if (unit === "mo") date.setUTCMonth(date.getUTCMonth() + amount)
  if (unit === "w") date.setUTCDate(date.getUTCDate() + amount * 7)
  if (unit === "d") date.setUTCDate(date.getUTCDate() + amount)
  if (unit === "h") date.setUTCHours(date.getUTCHours() + amount)
  if (unit === "m") date.setUTCMinutes(date.getUTCMinutes() + amount)

  const untilDate = Math.floor(date.getTime() / 1000)
  const maxUntilDate = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000)
  return untilDate <= maxUntilDate ? untilDate : undefined
}

async function cmdBan(ctx: MeContext): Promise<void> {
  if (!(await requirePermission(ctx, { family: "A", rank: 3 }))) {
    return
  }

  const reply = ctx.msg?.reply_to_message
  const chatId = ctx.chat?.id
  if (chatId === undefined) {
    return
  }
  const input = typeof ctx.match === "string" ? ctx.match : ""
  const lines = input.split(/\r?\n/)
  const firstLine = lines.shift()?.trim() ?? ""
  const cause = lines.join("\n").trim()
  if (!cause) {
    await ctx.reply("[denied]\ncause is required on the next line")
    return
  }

  let userId: number
  let timeLiteral: string | undefined
  let target: string
  if (reply?.from) {
    userId = reply.from.id
    timeLiteral = firstLine || undefined
    target = reply.from.first_name
  } else {
    const targetMatch = /^(\d+)(?:\s+(\S+))?$/.exec(firstLine)
    if (!targetMatch) {
      await ctx.reply("[denied]\nusage: /ban <id> [time] followed by a cause on the next line")
      return
    }
    userId = Number(targetMatch[1])
    if (!Number.isSafeInteger(userId) || userId < 1) {
      await ctx.reply("[denied]\ninvalid user ID")
      return
    }
    timeLiteral = targetMatch[2]
    target = targetMatch[1]
  }

  const untilDate = parseBanUntilDate(timeLiteral)
  if (untilDate === undefined) {
    await ctx.reply("[denied]\ninvalid time; use 15m, 12h, 7d, 2w, or 6mo")
    return
  }

  try {
    await ctx.banChatMember(userId, { until_date: untilDate })
  } catch (error) {
    console.error(error)
    await ctx.reply("[denied]\nfailed to ban user")
    return
  }

  try {
    recordBan(chatId, userId, cause)
  } catch (error) {
    console.error("failed to save ban record", error)
    await ctx.reply("[denied]\nuser was banned, but the record could not be saved")
    return
  }

  await ctx.reply(`[done]\nbanned ${target} for ${timeLiteral ?? "6mo"}`)
}

function formatUntilDate(untilDate: number): string {
  if (untilDate === 0) return "never"
  return `${new Date(untilDate * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

async function cmdInfo(ctx: MeContext): Promise<void> {
  if (!(await requirePermission(ctx, { family: "A", rank: 3 }))) {
    return
  }

  const chatId = ctx.chat?.id
  if (chatId === undefined) {
    return
  }

  const replyUser = ctx.msg?.reply_to_message?.from
  const argument = typeof ctx.match === "string" ? ctx.match.trim() : ""
  let userId: number
  if (replyUser) {
    if (argument) {
      await ctx.reply("[denied]\nreply to a user without arguments, or use /info <id>")
      return
    }
    userId = replyUser.id
  } else {
    if (!/^\d+$/.test(argument)) {
      await ctx.reply("[denied]\nusage: /info <id> or reply to a user's message")
      return
    }
    userId = Number(argument)
    if (!Number.isSafeInteger(userId) || userId < 1) {
      await ctx.reply("[denied]\ninvalid user ID")
      return
    }
  }

  if (String(userId) === String(config.OwnerInfo.OwnerID)) {
    await ctx.reply("This user is the bot owner.\nStatus: MF")
    return
  }

  try {
    const member = await ctx.api.getChatMember(chatId, userId)
    if (member.status === "kicked") {
      const cause = getLatestBanCause(chatId, userId) ?? "Unknown"
      await ctx.reply(
        `This user was banned.\nCause:\n${cause}\nUnban expected: ${formatUntilDate(member.until_date)}`,
      )
      return
    }
    if (member.status === "restricted") {
      await ctx.reply(`This user is restricted.\nRestrictions end: ${formatUntilDate(member.until_date)}`)
      return
    }

    let permission = "none"
    try {
      const role = await getPermission({ tgid: userId })
      permission = `${role.family}${role.rank.toString(16).toUpperCase()}`
    } catch (error) {
      console.error("failed to get user permission", error)
    }

    const membership = member.status === "left" ? "not a member of this chat" : "not restricted"
    await ctx.reply(`This user is ${membership}.\nStatus: ${permission}`)
  } catch (error) {
    console.error("failed to get chat member", error)
    await ctx.reply("[denied]\nuser was not found in this chat")
  }
}

async function cmdSet(ctx: MeContext): Promise<void> {
  if (!(await requirePermission(ctx, { family: "A", rank: 3 }))) {
    return
  }

  const chatId = ctx.chat?.id
  if (chatId === undefined) {
    return
  }

  const topicId = ctx.msg?.message_thread_id
  const args = typeof ctx.match === "string" ? ctx.match.trim().split(/\s+/) : []
  if (args.length === 1 && args[0] === "chat-topic") {
    if (topicId === undefined) {
      await ctx.reply("[denied]\nrun this command in the target forum topic")
      return
    }
    setCaptchaTopic(chatId, topicId)
    await ctx.reply("[done]\nset chat-topic")
    return
  }

  if (args.length === 2 && args[0] === "captcha-mode") {
    const modes: Record<string, CaptchaMode> = {
      disable: "disabled",
      bastion: "bastion",
      antibot: "antibot",
    }
    const mode = modes[args[1]]
    if (mode === undefined) {
      await ctx.reply("usage: /set captcha-mode <disable|bastion|antibot>")
      return
    }

    setCaptchaMode(chatId, mode)
    await ctx.reply(`[done]\nset captcha-mode ${mode}`)
    return
  }

  await ctx.reply("usage: /set chat-topic or /set captcha-mode <disable|bastion|antibot>")
}
