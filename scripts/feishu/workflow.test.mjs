import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inbound,
  openWorkflow,
  recordEvent,
  processInbox,
} from './workflow.mjs';
import {
  canAutoMerge,
  prNotification,
  runDevelopment,
} from './development.mjs';
import { taskDescription } from './runner.mjs';

test('auto-merge requires approval of the current head and a successful CI verify job', () => {
  const verify = {
    workflowName: 'CI',
    name: 'verify',
    status: 'COMPLETED',
    conclusion: 'SUCCESS',
  };
  const pr = {
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    baseRefName: 'main',
    headRefName: 'feat/feishu-example',
    headRefOid: 'approved',
    mergeStateStatus: 'CLEAN',
    statusCheckRollup: [verify],
  };
  assert.equal(canAutoMerge(pr, 'approved', pr.headRefName), true);
  assert.equal(canAutoMerge(pr, undefined, pr.headRefName), false);
  for (const change of [
    { headRefOid: 'new-commit' },
    { headRefName: 'other-branch' },
    { baseRefName: 'other-base' },
    { state: 'CLOSED' },
    { isDraft: true },
    { isCrossRepository: true },
    { mergeStateStatus: 'BLOCKED' },
    { reviewDecision: 'CHANGES_REQUESTED' },
    { statusCheckRollup: [] },
    { statusCheckRollup: [{ ...verify, workflowName: 'Other workflow' }] },
    {
      statusCheckRollup: [
        { ...verify, status: 'IN_PROGRESS', conclusion: null },
      ],
    },
    { statusCheckRollup: [verify, { ...verify, conclusion: 'FAILURE' }] },
  ])
    assert.equal(
      canAutoMerge({ ...pr, ...change }, 'approved', pr.headRefName),
      false,
    );
});

test('notifies the thread only for an open CI failure or a final PR state', () => {
  assert.equal(prNotification({ state: 'OPEN' }, 'CI 待完成'), null);
  assert.equal(prNotification({ state: 'OPEN' }, 'CI 已通过'), null);
  assert.equal(prNotification({ state: 'OPEN' }, 'CI 未通过').key, 'ci-failed');
  assert.equal(prNotification({ state: 'MERGED' }, 'CI 已通过').key, 'merged');
  assert.equal(prNotification({ state: 'CLOSED' }, 'CI 待完成').key, 'closed');
});

test('converts repository references into task description text and preserves Feishu links', () => {
  assert.equal(
    taskDescription(
      '[README.md](/Users/local/project/README.md:49) [CI](.github/workflows/ci.yml) [PRD](https://example.feishu.cn/docx/abc)',
    ),
    'README.md CI [PRD](https://example.feishu.cn/docx/abc)',
  );
});

const config = {
  chats: new Set(['oc_allowed', 'oc_other']),
  approvers: new Set(['ou_approver']),
  bot: 'ou_bot',
  develop: true,
};
const event = {
  type: 'im.message.receive_v1',
  chat_type: 'group',
  sender_type: 'user',
  message_type: 'text',
  chat_id: 'oc_allowed',
  sender_id: 'ou_author',
  message_id: 'om_origin',
  root_id: 'om_topic',
  thread_id: 'omt_topic',
  mentions: [{ id: 'ou_bot', key: '@_user_1' }],
  content: '@_user_1 #需求 示例',
};
const draft = { title: '标题', spec: '验收标准', needsDecision: false };

test('accepts a rendered Feishu reply mentioning the application and keeps its parent', () => {
  const reply = inbound(
    {
      ...event,
      content: "<p>@chenhao's Feishu CLI #需求</p>",
      mentions: [
        { id: 'cli_bot', key: '@_user_1', name: "chenhao's Feishu CLI" },
      ],
      root_id: null,
      reply_to: 'om_shared_prd',
    },
    { ...config, app: 'cli_bot' },
  );
  assert.equal(reply?.content, '#需求');
  assert.equal(reply?.parent, 'om_shared_prd');
});

test('rejects foreign groups, private chats, bots and mentions of other users', () => {
  for (const change of [
    { chat_id: 'oc_unknown' },
    { chat_type: 'p2p' },
    { sender_type: 'bot' },
    { mentions: [{ id: 'ou_other' }] },
    { content: '随意聊天' },
  ]) {
    assert.equal(inbound({ ...event, ...change }, config), null);
  }
  assert.equal(inbound(event, config)?.content, '#需求 示例');
});

test('persists approval, rejects other users and threads, retries reply without creating a second task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'magic-growth-feishu-test-'));
  const file = join(dir, 'inbox.sqlite');
  let db = openWorkflow(file);
  let attempts = 0;
  let tasks = 0;
  let drafts = 0;
  const services = {
    async draft() {
      drafts++;
      return draft;
    },
    async task() {
      tasks++;
      return { guid: 'fixture', url: 'https://example.test/task' };
    },
    async reply(_id, text) {
      if (!text.includes('已确认并创建')) return 'om_draft';
      if (++attempts === 1) throw new Error('上游暂时失败');
      return 'om_task';
    },
  };
  try {
    const request = inbound(event, config);
    assert.equal(recordEvent(db, request), true);
    assert.equal(recordEvent(db, request), false);
    assert.deepEqual(await processInbox(db, config, services), []);
    const { id, revision } = db
      .prepare('SELECT id, revision FROM requests')
      .get();
    const confirm = {
      ...event,
      sender_id: 'ou_approver',
      content: `@_user_1 确认需求 ${id} ${revision}`,
    };
    for (const [message_id, change] of [
      ['om_wrong_sender', { sender_id: 'ou_author' }],
      ['om_wrong_chat', { chat_id: 'oc_other' }],
      ['om_wrong_root', { root_id: 'om_other', thread_id: 'omt_other' }],
      ['om_wrong_version', { content: `@_user_1 确认需求 ${id} 000000000000` }],
    ])
      recordEvent(db, inbound({ ...confirm, message_id, ...change }, config));
    assert.deepEqual(await processInbox(db, config, services), []);
    assert.equal(tasks, 0);
    recordEvent(
      db,
      inbound(
        { ...confirm, message_id: 'om_approved', root_id: undefined },
        config,
      ),
    );
    assert.equal((await processInbox(db, config, services)).length, 1);
    db.close();
    db = openWorkflow(file);
    assert.deepEqual(await processInbox(db, config, services), []);
    assert.equal(drafts, 1);
    assert.equal(tasks, 1);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM development_jobs').get().count,
      1,
    );
    assert.equal(attempts, 2);
    assert.equal(
      db.prepare('SELECT task_reply_id FROM requests').get().task_reply_id,
      'om_task',
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('development queue claims once and persists failures and completed checks', async () => {
  const db = openWorkflow(':memory:');
  try {
    db.exec(
      "INSERT INTO requests (id, origin, draft, revision) VALUES ('a', '{}', '{}', 'a'), ('b', '{}', '{}', 'b')",
    );
    db.exec("INSERT INTO development_jobs (request_id) VALUES ('a'), ('b')");
    await runDevelopment(db, async (job) => {
      assert.equal(job.request_id, 'a');
      assert.equal(await runDevelopment(db, assert.fail), false);
      throw new Error('check failed');
    });
    assert.equal(
      db
        .prepare("SELECT error FROM development_jobs WHERE request_id='a'")
        .get().error,
      'check failed',
    );
    await runDevelopment(db, async ({ request_id }) => {
      assert.equal(request_id, 'b');
      return { gates: ['test'] };
    });
    assert.equal(
      db
        .prepare("SELECT status FROM development_jobs WHERE request_id='b'")
        .get().status,
      'review',
    );
  } finally {
    db.close();
  }
});
