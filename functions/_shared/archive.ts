import type { Env } from '../types';
import { archiveOriginalPartsToTelegram, archiveOriginalToTelegram, TELEGRAM_ARCHIVE_PART_BYTES } from './telegram';
import type { RequestLogger } from './logger';

const UPDATE_TG_PENDING_SQL = `UPDATE images SET tg_file_id=NULL,tg_message_id=NULL,tg_chat_id=NULL,tg_status='pending',tg_error=NULL,updated_at=datetime('now') WHERE key=?`;
const UPDATE_TG_DONE_SQL = `UPDATE images SET tg_file_id=?,tg_message_id=?,tg_chat_id=?,tg_status='done',tg_error=NULL,updated_at=datetime('now') WHERE key=?`;
const UPDATE_TG_FAILED_SQL = `UPDATE images SET tg_status='failed',tg_error=?,updated_at=datetime('now') WHERE key=?`;
const errorMessage = (error: unknown): string => error instanceof Error && error.message.trim() ? error.message.slice(0, 300) : 'telegram_archive_failed';

export const markTelegramArchivePending = async (env: Env, key: string): Promise<void> => {
  await env.DB.prepare(UPDATE_TG_PENDING_SQL).bind(key).run();
  await env.DB.prepare('DELETE FROM telegram_archive_parts WHERE image_key=?').bind(key).run();
};

export const archiveOriginalAfterUpload = async (env: Env, original: File, key: string, logger?: RequestLogger): Promise<void> => {
  try {
    if (original.size > 20 * 1024 * 1024) {
      const parts = await archiveOriginalPartsToTelegram({ token: env.TG_BOT_TOKEN, chatId: env.TG_CHAT_ID, file: original, key });
      for (const part of parts) {
        await env.DB.prepare(`INSERT INTO telegram_archive_parts(image_key,part_index,total_parts,tg_file_id,tg_message_id,tg_chat_id,bytes) VALUES(?,?,?,?,?,?,?)`)
          .bind(key, part.part_index, part.total_parts, part.file_id, part.message_id, part.chat_id, part.bytes).run();
      }
      const first = parts[0];
      await env.DB.prepare(UPDATE_TG_DONE_SQL).bind(first.file_id, first.message_id, first.chat_id, key).run();
      return;
    }
    const archive = await archiveOriginalToTelegram({ token: env.TG_BOT_TOKEN, chatId: env.TG_CHAT_ID, file: original, key });
    await env.DB.prepare(UPDATE_TG_DONE_SQL).bind(archive.file_id, archive.message_id, archive.chat_id, key).run();
  } catch (archiveError) {
    logger?.error('Telegram original archive failed', { error: archiveError, context: { key, bytes: original.size, partSize: TELEGRAM_ARCHIVE_PART_BYTES } });
    await env.DB.prepare(UPDATE_TG_FAILED_SQL).bind(errorMessage(archiveError), key).run();
  }
};
