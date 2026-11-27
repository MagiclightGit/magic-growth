import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const messageId = /^om_[\w-]+$/;
const chatId = /^oc_[\w-]+$/;
const personId = /^ou_[\w-]+$/;
const requestPattern = /^(?:#需求|创建任务|提需求)(?:\s|[：:]|$)/u;

export const digest = (text) =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);

export function inbound(event, config) {
  if (
    event?.type !== 'im.message.receive_v1' ||
    event.chat_type !== 'group' ||
    event.sender_type !== 'user' ||
    !chatId.test(event.chat_id) ||
    !config.chats.has(event.chat_id) ||
    !personId.test(event.sender_id) ||
    !messageId.test(event.message_id) ||
    event.message_type !== 'text' ||
    typeof event.content !== 'string'
  )
    return null;

  const mentions = Array.isArray(event.mentions) ? event.mentions : [];
  const isBot = ({ id }) =>
    Boolean(id) && (id === config.bot || id === config.app);
  const addressed = mentions.some(isBot);
  if (!addressed) return null;
  const content = mentions
    .filter(isBot)
    .reduce((value, { key, name }) => {
      if (key) value = value.replaceAll(key, '');
      if (name) value = value.replaceAll(`@${name}`, '');
      return value;
    }, event.content)
    .replace(/^\s*<p>([^<>]*)<\/p>\s*$/u, '$1')
    .trim();
  const approval = /^确认需求\s+([a-f0-9]{12})\s+([a-f0-9]{12})$/u.exec(
    content,
  );
  if (!approval && !requestPattern.test(content)) return null;

  return {
    id: event.message_id,
    chat: event.chat_id,
    root: messageId.test(event.root_id) ? event.root_id : event.message_id,
    parent: messageId.test(event.reply_to) ? event.reply_to : null,
    thread: /^(?:omt_|om_)[\w-]+$/.test(event.thread_id)
      ? event.thread_id
      : null,
    sender: event.sender_id,
    content,
    approval: approval?.slice(1) ?? null,
  };
}

export function openWorkflow(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const oldMask = process.umask(0o077);
  let db;
  try {
    db = new DatabaseSync(file);
  } finally {
    process.umask(oldMask);
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      handled INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      origin TEXT NOT NULL,
      draft TEXT NOT NULL,
      revision TEXT NOT NULL,
      reply_id TEXT,
      approved_by TEXT,
      task_guid TEXT,
      task_url TEXT,
      task_reply_id TEXT
    );
    CREATE TABLE IF NOT EXISTS development_jobs (
      request_id TEXT PRIMARY KEY REFERENCES requests(id),
      status TEXT NOT NULL DEFAULT 'queued',
      started_at INTEGER,
      report TEXT,
      error TEXT,
      pr_url TEXT,
      notice TEXT
    );
  `);
  return db;
}

export function recordEvent(db, event) {
  return (
    db
      .prepare('INSERT OR IGNORE INTO inbox (id, event) VALUES (?, ?)')
      .run(event.id, JSON.stringify(event)).changes > 0
  );
}

export async function processInbox(db, config, services) {
  const pending = db
    .prepare('SELECT * FROM inbox WHERE handled = 0 ORDER BY rowid')
    .all();
  const errors = [];
  for (const row of pending) {
    const event = JSON.parse(row.event);
    if (!config.chats.has(event.chat)) continue;
    if (
      config.message &&
      event.id !== config.message &&
      event.approval?.[0] !== digest(config.message).slice(0, 12)
    )
      continue;
    try {
      if (event.approval) await approve(db, config, services, event);
      else await draftRequest(db, services, event);
      db.prepare('UPDATE inbox SET handled = 1, error = NULL WHERE id = ?').run(
        row.id,
      );
    } catch (error) {
      db.prepare('UPDATE inbox SET error = ? WHERE id = ?').run(
        error.message,
        row.id,
      );
      errors.push({ id: row.id, message: error.message });
    }
  }
  return errors;
}

async function draftRequest(db, services, event) {
  const id = digest(event.id).slice(0, 12);
  const read = db.prepare('SELECT * FROM requests WHERE id = ?');
  let request = read.get(id);
  if (!request) {
    const draft = await services.draft(event);
    if (
      typeof draft.title !== 'string' ||
      !draft.title.trim() ||
      draft.title.length > 80 ||
      typeof draft.spec !== 'string' ||
      !draft.spec.trim() ||
      draft.spec.length > 4800 ||
      typeof draft.needsDecision !== 'boolean'
    )
      throw new Error('需求草案结构无效');
    const json = JSON.stringify(draft);
    db.prepare(
      'INSERT OR IGNORE INTO requests (id, origin, draft, revision) VALUES (?, ?, ?, ?)',
    ).run(id, JSON.stringify(event), json, digest(json).slice(0, 12));
    request = read.get(id);
  }
  if (request.reply_id) return;
  const draft = JSON.parse(request.draft);
  const footer = draft.needsDecision
    ? '请在话题中补齐决策，再 @机器人 发送 #需求 生成新版草案。'
    : `审批人核对后，在本话题 @机器人 并发送：确认需求 ${id} ${request.revision}`;
  const replyId = await services.reply(
    event.id,
    `# ${draft.title}\n\n${draft.spec}\n\n${footer}`,
    digest(`draft:${id}:${request.revision}`),
    'markdown',
  );
  db.prepare('UPDATE requests SET reply_id = ? WHERE id = ?').run(replyId, id);
}

async function approve(db, config, services, event) {
  const [id, revision] = event.approval;
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (
    !config.approvers.has(event.sender) ||
    !request ||
    request.revision !== revision
  )
    return;
  const origin = JSON.parse(request.origin);
  if (
    origin.chat !== event.chat ||
    !request.reply_id ||
    JSON.parse(request.draft).needsDecision
  )
    return;
  const sameRoot = [origin.root, origin.id, request.reply_id].includes(
    event.root,
  );
  if (
    !sameRoot &&
    (!event.thread ||
      event.thread !==
        (origin.thread ?? (await services.thread(request.reply_id))))
  )
    return;

  db.prepare(
    'UPDATE requests SET approved_by = COALESCE(approved_by, ?) WHERE id = ?',
  ).run(event.sender, id);
  if (!request.task_guid) {
    const task = await services.task({
      ...JSON.parse(request.draft),
      id,
      approver: request.approved_by ?? event.sender,
      source: `https://applink.feishu.cn/client/chat/open?openChatId=${origin.chat}`,
      token: digest(`task:${id}:${revision}`),
    });
    db.prepare(
      'UPDATE requests SET task_guid = ?, task_url = ? WHERE id = ?',
    ).run(task.guid, task.url, id);
    Object.assign(request, { task_guid: task.guid, task_url: task.url });
  }
  if (config.develop)
    db.prepare(
      'INSERT OR IGNORE INTO development_jobs (request_id) VALUES (?)',
    ).run(id);
  if (request.task_reply_id) return;
  const replyId = await services.reply(
    origin.id,
    `需求 ${id} 已确认并创建飞书任务\n${request.task_url}`,
    digest(`task-reply:${id}`),
  );
  db.prepare('UPDATE requests SET task_reply_id = ? WHERE id = ?').run(
    replyId,
    id,
  );
}
