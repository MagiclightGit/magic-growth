#!/usr/bin/env node
/**
 * 飞书群需求接入与进展回写脚手架（基于本机 lark-cli）。
 *
 * 子命令：
 *   --check                                检查 lark-cli 可用性（不启动长驻监听）
 *   listen [--trigger "#需求,创建任务"]      通过 lark-cli event consume 监听群消息并落盘到 artifacts/feishu-intake/
 *   reply --message-id <om_xxx> --text <t> [--dry-run]  向原飞书消息/话题回写进展
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';

const args = process.argv.slice(2).filter((a) => a !== '--');
const subcommand = args[0] || '--check';

const getFlag = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

function ensureLarkCli() {
  try {
    const bin = execFileSync('which', ['lark-cli'], {
      encoding: 'utf8',
    }).trim();
    return bin;
  } catch {
    console.error(
      '未找到 lark-cli。请先安装并完成授权（lark-cli auth login）。',
    );
    process.exit(1);
  }
}

if (subcommand === '--check' || subcommand === 'check') {
  const bin = ensureLarkCli();
  console.log(`[OK] lark-cli 已安装: ${bin}`);
  try {
    const status = execFileSync('lark-cli', ['auth', 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    console.log(status || '[OK] lark-cli auth status 返回成功');
  } catch (err) {
    console.warn(
      '[WARN] lark-cli 尚未完成登录授权，或当前沙箱限制访问凭据。请在常驻机执行 lark-cli auth status 确认。',
    );
    if (err && typeof err === 'object' && 'stderr' in err && err.stderr) {
      console.warn(String(err.stderr).trim());
    }
  }
  process.exit(0);
}

if (subcommand === 'listen') {
  ensureLarkCli();
  const triggers = getFlag('--trigger', '#需求,创建任务,提需求')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const outDir = path.join(process.cwd(), 'artifacts', 'feishu-intake');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(
    `启动飞书群消息监听（事件 im.message.receive_v1，触发关键词: ${triggers.join(' / ')}）...`,
  );
  const child = spawn(
    'lark-cli',
    ['event', 'consume', 'im.message.receive_v1', '--as', 'bot'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  // 保持 stdin 打开以防止无界监听因 EOF 提前退出（遵循 lark-event 契约）
  const keepAlive = setInterval(() => {}, 60_000);
  const shutdown = () => {
    clearInterval(keepAlive);
    child.stdin.end();
    child.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const errRl = readline.createInterface({ input: child.stderr });
  errRl.on('line', (line) => {
    console.error(line);
  });

  const outRl = readline.createInterface({ input: child.stdout });
  outRl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const payload = JSON.parse(line);
      const event = payload.event ?? payload;
      const msg = event.message ?? {};
      const content = String(msg.content ?? '');
      const mentions = Array.isArray(msg.mentions) ? msg.mentions : [];
      const matched =
        mentions.length > 0 || triggers.some((kw) => content.includes(kw));
      if (!matched) return;

      const id = String(
        msg.message_id || payload.header?.event_id || Date.now(),
      ).replace(/[^\w-]/g, '_');
      const file = path.join(outDir, `${id}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            receivedAt: new Date().toISOString(),
            chatId: msg.chat_id ?? null,
            threadId: msg.thread_id ?? null,
            messageId: msg.message_id ?? null,
            senderId: event.sender?.sender_id?.open_id ?? null,
            content,
            raw: payload,
          },
          null,
          2,
        ),
        'utf8',
      );
      console.log(`[INTAKE] 已保存群需求事件 -> ${file}`);
    } catch (err) {
      console.error('[WARN] 无法解析事件行：', err);
    }
  });

  child.on('exit', (code) => {
    clearInterval(keepAlive);
    process.exit(code ?? 0);
  });
} else if (subcommand === 'reply') {
  const messageId = getFlag('--message-id');
  const markdown = getFlag('--markdown');
  const text = getFlag('--text');
  const idempotencyKey = getFlag('--idempotency-key');
  const dryRun = args.includes('--dry-run');
  const noThread = args.includes('--no-thread');
  if (!messageId || (!markdown && !text) || (markdown && text)) {
    console.error(
      '用法: pnpm feishu:intake -- reply --message-id <om_xxx> (--markdown "进展" | --text "纯文本") [--idempotency-key <key>] [--no-thread] [--dry-run]',
    );
    process.exit(1);
  }
  const cmdArgs = [
    'im',
    '+messages-reply',
    '--as',
    'bot',
    '--message-id',
    messageId,
    ...(markdown ? ['--markdown', markdown] : ['--text', text]),
    ...(noThread ? [] : ['--reply-in-thread']),
    ...(idempotencyKey ? ['--idempotency-key', idempotencyKey] : []),
  ];
  if (dryRun) {
    console.log('[DRY-RUN] lark-cli', cmdArgs.join(' '));
    process.exit(0);
  }
  ensureLarkCli();
  execFileSync('lark-cli', cmdArgs, { stdio: 'inherit' });
} else {
  console.error(`未知子命令：${subcommand}\n支持：--check | listen | reply`);
  process.exit(1);
}
