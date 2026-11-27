import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { createDatabase, auth } from '@guangmo/database';
import { eq } from 'drizzle-orm';
import { memberInput } from '@guangmo/contracts';
import { provisionMember } from '../modules/members/provision-member.js';
import { env } from '../config/env.js';
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) stdout.write(chunk);
    done();
  },
});
const rl = createInterface({ input: stdin, output, terminal: stdin.isTTY });
const { db, pool } = createDatabase(env.DATABASE_URL);
try {
  const existing = await db
    .select({ id: auth.user.id })
    .from(auth.user)
    .where(eq(auth.user.role, 'admin'))
    .limit(1);
  if (existing.length)
    throw new Error('已有管理员，请登录后在成员管理开通账号');
  const name = await rl.question('管理员姓名：');
  const email = await rl.question('管理员邮箱：');
  stdout.write('密码（至少12位，输入隐藏）：');
  muted = true;
  const password = await rl.question('');
  muted = false;
  stdout.write('\n');
  const input = memberInput.parse({ name, email, password, role: 'admin' });
  const member = await provisionMember(db, input);
  console.log(`管理员已创建：${member?.email}`);
} finally {
  rl.close();
  await pool.end();
}
