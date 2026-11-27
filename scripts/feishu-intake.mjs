#!/usr/bin/env node
/**
 * 飞书群需求接入与进展回写脚手架（基于本机 lark-cli）。
 *
 * 子命令：
 *   --check                                检查 lark-cli 可用性（不启动长驻监听）
 *   listen [--timeout 30s] [--apply]        监听指定群并持久化，带 --apply 时处理草案与审批
 *   reply --message-id <om_xxx> --text <t> [--dry-run]  向原飞书消息/话题回写进展
 */
import { execFileSync } from 'node:child_process';
import { listen } from './feishu/runner.mjs';
import { developmentCommand } from './feishu/development.mjs';

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
  await listen({
    apply: args.includes('--apply'),
    timeout: getFlag('--timeout'),
    message: getFlag('--message-id'),
    develop: args.includes('--develop'),
  });
} else if (['develop', 'publish', 'retry', 'sync'].includes(subcommand)) {
  await developmentCommand(subcommand, {
    id: getFlag('--request-id'),
    watch: args.includes('--watch'),
    autoMerge: args.includes('--auto-merge'),
    autoReview: args.includes('--auto-review'),
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
  console.error(
    `未知子命令：${subcommand}\n支持：--check | listen | reply | develop | publish | retry | sync`,
  );
  process.exit(1);
}
