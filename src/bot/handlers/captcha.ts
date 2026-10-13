import { randomUUID } from "node:crypto"
import { InlineKeyboard, type Bot } from "grammy"
import type { MeContext } from "../../../types.js"
import { getChatSettings } from "../../lib/chat-settings.js"

type ChallengeMode = "antibot" | "bastion"

type Challenge = {
  mode: ChallengeMode
  chatId: number
  userId: number
  messageChatId: number
  messageId: number
  chatUrl?: string
  answer: number
  attemptsLeft: number
  expiresAt: number
  timeout: ReturnType<typeof setTimeout>
}

const challenges = new Map<string, Challenge>()
const captchaTimeoutMs: Record<ChallengeMode, number> = {
  antibot: 120_000,
  bastion: 240_000,
}
const captchaAttempts = 2

const mutedPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_react_to_messages: false,
  can_change_info: false,
  can_invite_users: false,
  can_edit_tag: false,
  can_pin_messages: false,
  can_manage_topics: false,
}

const unrestrictedPermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_react_to_messages: true,
  can_change_info: true,
  can_invite_users: true,
  can_edit_tag: true,
  can_pin_messages: true,
  can_manage_topics: true,
}

async function createChallenge(
  bot: Bot<MeContext>,
  mode: ChallengeMode,
  chatId: number,
  userId: number,
  messageChatId: number,
  chatUrl: string | undefined,
  send: (text: string, keyboard: InlineKeyboard) => Promise<{ message_id: number }>,
): Promise<void> {
  const left = Math.floor(Math.random() * 8) + 1
  const right = Math.floor(Math.random() * 8) + 1
  const answer = left + right
  const options = new Set([answer])
  while (options.size < 4) {
    options.add(Math.max(0, answer + Math.floor(Math.random() * 7) - 3))
  }

  const challengeId = randomUUID()
  const keyboard = new InlineKeyboard()
  for (const option of [...options].sort(() => Math.random() - 0.5)) {
    keyboard.text(String(option), `captcha:${challengeId}:${option}`)
  }

  const message = await send(`Solve the captcha: ${left} + ${right} = ?`, keyboard)
  const timeoutMs = captchaTimeoutMs[mode]
  const expiresAt = Date.now() + timeoutMs
  const timeout = setTimeout(() => {
    void removeFailedMember(bot, challengeId)
  }, timeoutMs)
  challenges.set(challengeId, {
    mode,
    chatId,
    userId,
    messageChatId,
    messageId: message.message_id,
    chatUrl,
    answer,
    attemptsLeft: captchaAttempts,
    expiresAt,
    timeout,
  })
}

async function removeFailedMember(bot: Bot<MeContext>, challengeId: string): Promise<void> {
  const challenge = challenges.get(challengeId)
  if (!challenge) return

  challenges.delete(challengeId)
  clearTimeout(challenge.timeout)

  try {
    if (challenge.mode === "antibot") {
      // Telegram implements a kick as an immediate ban followed by an unban.
      await bot.api.banChatMember(challenge.chatId, challenge.userId)
      await bot.api.unbanChatMember(challenge.chatId, challenge.userId)
    } else {
      await bot.api.declineChatJoinRequest(challenge.chatId, challenge.userId)
    }
  } catch (error) {
    console.error("failed to remove captcha member", error)
  }

  try {
    await bot.api.deleteMessage(challenge.messageChatId, challenge.messageId)
  } catch (error) {
    console.error("failed to delete captcha message", error)
  }
}

export function registerJoinCaptcha(bot: Bot<MeContext>): void {
  bot.on("message:new_chat_members", async (ctx) => {
    const settings = getChatSettings(ctx.chat.id)
    if (settings?.captchaMode !== "antibot") return

    for (const member of ctx.msg.new_chat_members) {
      if (member.is_bot) continue

      let restricted = false
      try {
        await ctx.restrictChatMember(member.id, mutedPermissions)
        restricted = true
        const messageOptions = {
          ...(settings.captchaTopicId === undefined ? {} : { message_thread_id: settings.captchaTopicId }),
        }
        await ctx.api.sendMessage(
          ctx.chat.id,
          `Hello! This is MFDCensor. To join ${ctx.chat.title ?? "this chat"}, you need to pass a captcha.`,
          messageOptions,
        )
        await createChallenge(
          bot,
          "antibot",
          ctx.chat.id,
          member.id,
          ctx.chat.id,
          undefined,
          (text, keyboard) => ctx.api.sendMessage(ctx.chat.id, `${member.first_name}, ${text}`, {
            reply_markup: keyboard,
            ...messageOptions,
          }),
        )
      } catch (error) {
        console.error("failed to create join captcha", error)
        if (restricted) {
          await ctx.api.restrictChatMember(ctx.chat.id, member.id, unrestrictedPermissions)
        }
      }
    }
  })

  bot.on("chat_join_request", async (ctx) => {
    const request = ctx.chatJoinRequest
    if (!request || getChatSettings(request.chat.id)?.captchaMode !== "bastion") return

    try {
      let chatUrl = request.invite_link?.invite_link
        ?? (request.chat.username === undefined ? undefined : `https://t.me/${request.chat.username}`)
      if (chatUrl === undefined) {
        chatUrl = (await ctx.api.getChat(request.chat.id)).invite_link
      }
      await ctx.api.sendMessage(
        request.user_chat_id,
        `Hello! This is MFDCensor. To join ${request.chat.title}, you need to pass a captcha.`,
      )
      await createChallenge(
        bot,
        "bastion",
        request.chat.id,
        request.from.id,
        request.user_chat_id,
        chatUrl,
        (text, keyboard) => ctx.api.sendMessage(request.user_chat_id, text, { reply_markup: keyboard }),
      )
    } catch (error) {
      console.error("failed to create bastion captcha", error)
      await ctx.api.declineChatJoinRequest(request.chat.id, request.from.id)
    }
  })

  bot.on("callback_query:data", async (ctx) => {
    const match = /^captcha:([\da-f-]+):(\d+)$/.exec(ctx.callbackQuery.data)
    if (!match) return

    const [, challengeId, selectedAnswer] = match
    const challenge = challenges.get(challengeId)
    if (!challenge) {
      await ctx.answerCallbackQuery({ text: "This captcha is no longer valid." })
      return
    }
    if (ctx.from.id !== challenge.userId) {
      await ctx.answerCallbackQuery({ text: "This captcha is not for you." })
      return
    }
    if (Date.now() >= challenge.expiresAt) {
      const removal = removeFailedMember(bot, challengeId)
      await ctx.answerCallbackQuery({ text: "Captcha expired." })
      await removal
      return
    }
    if (Number(selectedAnswer) !== challenge.answer) {
      challenge.attemptsLeft -= 1
      if (challenge.attemptsLeft === 0) {
        const removal = removeFailedMember(bot, challengeId)
        await ctx.answerCallbackQuery({ text: "No attempts left." })
        await removal
        return
      }
      await ctx.answerCallbackQuery({ text: `Wrong answer. ${challenge.attemptsLeft} attempt left.` })
      return
    }

    try {
      if (challenge.mode === "antibot") {
        await ctx.api.restrictChatMember(challenge.chatId, challenge.userId, unrestrictedPermissions)
      } else {
        await ctx.api.approveChatJoinRequest(challenge.chatId, challenge.userId)
      }
    } catch (error) {
      console.error("failed to complete captcha", error)
      await ctx.answerCallbackQuery({ text: "Failed to complete captcha. Please contact an admin." })
      return
    }

    challenges.delete(challengeId)
    clearTimeout(challenge.timeout)
    await ctx.answerCallbackQuery({ text: "Captcha passed." })
    await ctx.editMessageText(
      challenge.mode === "antibot"
        ? "Captcha passed. You can now send messages."
        : "Captcha passed. Your join request was approved.",
      { reply_markup: { inline_keyboard: [] } },
    )
    if (challenge.mode === "bastion" && challenge.chatUrl !== undefined) {
      await ctx.api.sendMessage(challenge.messageChatId, "Here is the link to the chat.", {
        reply_markup: new InlineKeyboard().url("Chat", challenge.chatUrl),
      })
    }
  })
}
