#!/usr/bin/env node
/**
 * 推送三个远端并在成功后发送企微通知。
 *
 * 用法：
 *   node scripts/git/push-and-notify.mjs            # 推送当前分支 + main + codeup master
 *   node scripts/git/push-and-notify.mjs --dry      # 只打印将要发送的内容
 *
 * webhook 来源（按顺序）：
 *   1. 环境变量 TESTPILOT_WECOM_WEBHOOK
 *   2. 仓库根的 .secrets/wecom-webhook.txt（不入库）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT = process.platform === 'win32' ? 'git' : 'git';
const dry = process.argv.includes('--dry');

const run = (args, options = {}) => execFileSync(GIT, ['-C', REPO, ...args], { encoding: 'utf8', ...options }).trim();
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' };

function webhook() {
  if (process.env.TESTPILOT_WECOM_WEBHOOK) return process.env.TESTPILOT_WECOM_WEBHOOK.trim();
  const file = path.join(REPO, '.secrets', 'wecom-webhook.txt');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  return '';
}

function remoteHead(url, ref) {
  try {
    const out = run(['ls-remote', url, ref]);
    const line = out.split('\n').find((l) => l.includes(ref));
    return line ? line.split('\t')[0].trim() : '';
  } catch {
    return '';
  }
}

function markdown(sha, before, pushed) {
  const commits = pushed.length
    ? pushed.map((c) => `> · ${c}`).join('\n')
    : `> · ${run(['log', '-1', '--format=%h %s', sha])}`;
  const stat = before
    ? run(['diff', '--shortstat', `${before}..${sha}`])
    : run(['show', '--shortstat', '--format=', sha]);
  const files = before ? run(['diff', '--name-status', `${before}..${sha}`]).split('\n').filter(Boolean) : [];
  const added = files.filter((l) => l.startsWith('A')).length;
  const modified = files.filter((l) => l.startsWith('M')).length;
  const removed = files.filter((l) => l.startsWith('D')).length;
  const subject = run(['log', '-1', '--format=%s', sha]);
  const author = run(['log', '-1', '--format=%an', sha]);
  const repoName = run(['remote', 'get-url', 'origin']).replace(/\.git$/, '').split('/').pop();
  const link = `https://github.com/${run(['remote', 'get-url', 'origin']).replace(/\.git$/, '').split(':').pop()?.split('/').slice(-2).join('/')}/commit/${sha}`;
  return [
    '**TestPilot 代码已更新**',
    `> 仓库：${repoName}`,
    `> 分支：master`,
    `> 提交人：${author}`,
    `> 提交：${run(['log', '-1', '--format=%h', sha])} ${subject}`,
    `> 变更：新增 ${added} · 修改 ${modified} · 删除 ${removed}（共 ${files.length} 个文件${stat ? '，' + stat : ''}）`,
    '',
    commits,
    '',
    `[查看这次提交](${link})`
  ].join('\n');
}

async function send(content) {
  const hook = webhook();
  if (!hook) {
    console.log('未配置 webhook（TESTPILOT_WECOM_WEBHOOK 或 .secrets/wecom-webhook.txt），跳过通知。');
    return;
  }
  if (dry) {
    console.log('--- DRY RUN ---\n' + content);
    return;
  }
  const res = await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
  });
  console.log('通知：HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
}

const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
const sha = run(['rev-parse', 'HEAD']);
const originUrl = run(['remote', 'get-url', 'origin']);
const codeupUrl = (() => {
  try { return run(['remote', 'get-url', 'codeup']); } catch { return ''; }
})();

const before = remoteHead(originUrl, 'refs/heads/main') || remoteHead(originUrl, `refs/heads/${branch}`);
const pushed = before
  ? run(['log', '--no-merges', '--format=%h %s', `${before}..${sha}`]).split('\n').filter(Boolean)
  : [];

if (dry) {
  console.log('分支 ' + branch + '，待推送提交 ' + pushed.length + ' 个');
  await send(markdown(sha, before, pushed));
  process.exit(0);
}

const targets = [['origin', `HEAD:main`], ['origin', `HEAD:${branch}`]];
if (codeupUrl) targets.push(['codeup', 'HEAD:master']);

for (const [remote, refspec] of targets) {
  try {
    const helper = process.env.TESTPILOT_GIT_CRED_HELPER;
    const extra = remote === 'codeup' && helper ? ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`] : [];
    const out = execFileSync(GIT, ['-C', REPO, ...extra, 'push', remote, refspec], { encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    console.log(`push ${remote} ${refspec}: ${(out.match(/->|\\.\\.\\./) ? out.trim().split('\n').pop() : 'ok')}`);
  } catch (error) {
    const message = (error.stderr ?? error.message ?? '').toString().trim();
    if (/Everything up-to-date|up to date/i.test(message)) console.log(`push ${remote} ${refspec}: 已是最新`);
    else {
      console.error(`push ${remote} ${refspec} 失败：${message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
}

await send(markdown(sha, before, pushed));
