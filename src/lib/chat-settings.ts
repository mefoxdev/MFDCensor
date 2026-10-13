import { mkdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

export type CaptchaMode = "disabled" | "bastion" | "antibot"

export type ChatSettings = {
  chatId: number
  captchaTopicId: number | undefined
  captchaMode: CaptchaMode
}

mkdirSync("data", { recursive: true })

const database = new DatabaseSync("data/bot.sqlite")
database.exec(`
  CREATE TABLE IF NOT EXISTS chat_settings (
    chat_id INTEGER PRIMARY KEY,
    captcha_topic_id INTEGER,
    captcha_mode TEXT NOT NULL DEFAULT 'disabled'
      CHECK (captcha_mode IN ('disabled', 'bastion', 'antibot'))
  );

  CREATE TABLE IF NOT EXISTS ban_records (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    cause TEXT NOT NULL
  )
`)

const topicColumn = database.prepare("PRAGMA table_info(chat_settings)").all()
  .find((column) => column.name === "captcha_topic_id") as { notnull: number } | undefined

if (topicColumn?.notnull === 1) {
  database.exec(`
    ALTER TABLE chat_settings RENAME TO chat_settings_old;
    CREATE TABLE chat_settings (
      chat_id INTEGER PRIMARY KEY,
      captcha_topic_id INTEGER,
      captcha_mode TEXT NOT NULL DEFAULT 'disabled'
        CHECK (captcha_mode IN ('disabled', 'bastion', 'antibot'))
    );
    INSERT INTO chat_settings (chat_id, captcha_topic_id, captcha_mode)
    SELECT chat_id, captcha_topic_id, captcha_mode FROM chat_settings_old;
    DROP TABLE chat_settings_old;
  `)
}

const getSettings = database.prepare(`
  SELECT chat_id, captcha_topic_id, captcha_mode
  FROM chat_settings
  WHERE chat_id = ?
`)

const saveTopic = database.prepare(`
  INSERT INTO chat_settings (chat_id, captcha_topic_id)
  VALUES (?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET captcha_topic_id = excluded.captcha_topic_id
`)

const saveMode = database.prepare(`
  INSERT INTO chat_settings (chat_id, captcha_mode)
  VALUES (?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET captcha_mode = excluded.captcha_mode
`)

const saveBanRecord = database.prepare(`
  INSERT INTO ban_records (chat_id, user_id, cause)
  VALUES (?, ?, ?)
`)

const getLatestBanRecord = database.prepare(`
  SELECT cause
  FROM ban_records
  WHERE chat_id = ? AND user_id = ?
  ORDER BY rowid DESC
  LIMIT 1
`)

function rowToSettings(row: Record<string, unknown>): ChatSettings {
  return {
    chatId: row.chat_id as number,
    captchaTopicId: row.captcha_topic_id as number | undefined,
    captchaMode: row.captcha_mode as CaptchaMode,
  }
}

export function getChatSettings(chatId: number): ChatSettings | undefined {
  const row = getSettings.get(chatId) as Record<string, unknown> | undefined
  return row === undefined ? undefined : rowToSettings(row)
}

export function setCaptchaTopic(chatId: number, topicId: number): ChatSettings {
  saveTopic.run(chatId, topicId)
  return getChatSettings(chatId)!
}

export function setCaptchaMode(chatId: number, mode: CaptchaMode): ChatSettings | undefined {
  saveMode.run(chatId, mode)
  return getChatSettings(chatId)
}

export function recordBan(chatId: number, userId: number, cause: string): void {
  saveBanRecord.run(chatId, userId, cause)
}

export function getLatestBanCause(chatId: number, userId: number): string | undefined {
  const row = getLatestBanRecord.get(chatId, userId) as Record<string, unknown> | undefined
  return row?.cause as string | undefined
}
