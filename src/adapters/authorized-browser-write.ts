import type { Page } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { allowBrowserRequest } from './login-handoff.js';

export type WritePlan = {
  operationId: string; projectId: string; targetUrl: string; requestUrl: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; buttonText: string;
  authorization: string; successText: string; cleanupNotes: string;
};
type WriteRecord = { runId?: string; plan: WritePlan; digest: string; state: 'authorized' | 'attempting' | 'unknown' | 'verified'; updatedAt: string; requestReleased?: boolean; responseStatus?: number; businessCode?: number; applyNo?: string; afterUrl?: string; detail?: string };
export function validateWritePlan(value: unknown): WritePlan {
  const p = value as WritePlan;
  const keys = ['operationId','projectId','targetUrl','requestUrl','method','buttonText','authorization','successText','cleanupNotes'];
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !keys.includes(k)) || keys.some(k => typeof (p as any)[k] !== 'string' || !(p as any)[k].trim() || (p as any)[k].length > 2000)) throw new Error('需要完整的单次写入计划与授权依据。');
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(p.operationId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(p.projectId) || !['POST','PUT','PATCH','DELETE'].includes(p.method)) throw new Error('写入标识或方法无效。');
  const target = new URL(p.targetUrl), request = new URL(p.requestUrl);
  if (!['https:','http:'].includes(target.protocol) || target.username || target.password || request.username || request.password || request.hash || request.search || (request.origin !== target.origin && request.protocol !== 'https:')) throw new Error('跨域接口需要明确的 HTTPS 地址，不能携带查询凭据或重定向。');
  if (target.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(target.hostname)) throw new Error('远程写入需要 HTTPS。');
  return Object.fromEntries(keys.map(k => [k, (p as any)[k]])) as WritePlan;
}

/** An isolated, explicitly authorized write. Default regression lanes remain read-only. */
export function createAuthorizedBrowserWrite(directory: string) {
  const file = (id: string) => { if (!/^[A-Za-z0-9_-]{1,80}$/u.test(id)) throw new Error('无效操作 ID'); return path.join(directory, id + '.json'); };
  const read = async (id: string): Promise<WriteRecord> => JSON.parse(await readFile(file(id), 'utf8'));
  const save = async (r: WriteRecord) => { r.updatedAt = new Date().toISOString(); await writeFile(file(r.plan.operationId), JSON.stringify(r, null, 2), 'utf8'); };
  return {
    read,
    async authorize(value: unknown) {
      const plan = validateWritePlan(value);
      await mkdir(directory, { recursive: true });
      const record: WriteRecord = { plan, digest: createHash('sha256').update(JSON.stringify(plan)).digest('hex'), state: 'authorized', updatedAt: new Date().toISOString() };
      await writeFile(file(plan.operationId), JSON.stringify(record, null, 2), { flag: 'wx' });
      return record;
    },
    async execute(id: string, projectId: string, targetUrl: string, page: Page, runId?: string) {
      const record = await read(id), p = record.plan;
      if (p.projectId !== projectId || p.targetUrl !== targetUrl || record.state !== 'authorized') throw new Error('写入授权不匹配或已使用；请先核验既有申请，禁止自动重提。');
      if (Date.now() - Date.parse(record.updatedAt) > 30 * 60_000) throw new Error('单次写入授权已超过 30 分钟；未执行。');
      if (page.url() !== targetUrl) throw new Error('当前页面与授权页面不一致；未执行。');
      const button = page.getByText(p.buttonText, { exact: true });
      if (await button.count() !== 1 || !await button.isVisible() || !await button.isEnabled()) throw new Error('提交控件必须唯一、可见且启用。');
      const evidenceDir = path.join(directory, id);
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDir, 'before.png'), fullPage: true });
      // Exclusive, durable claim before input. Survives crashes/restarts and concurrent calls.
      await writeFile(path.join(evidenceDir, 'attempt.lock'), new Date().toISOString(), { flag: 'wx' });
      record.state = 'attempting'; if(runId)record.runId=runId; await save(record);
      let released = false;
      await page.unrouteAll({ behavior: 'wait' });
      await page.route('**/*', async route => {
        const request = route.request();
        if (!released && request.url() === p.requestUrl && request.method() === 'OPTIONS') { await route.continue(); return; }
        if (!released && request.url() === p.requestUrl && request.method() === p.method && !request.redirectedFrom()) {
          released = true; record.requestReleased = true;
          try { await save(record); await route.continue(); } catch { await route.abort().catch(() => undefined); }
          return;
        }
        if (request.url() === p.requestUrl || request.redirectedFrom() || !allowBrowserRequest(request.method(), request.url(), projectId, { targetOrigin: new URL(targetUrl).origin, resourceType: request.resourceType() })) { await route.abort('blockedbyclient'); return; }
        await route.continue();
      });
      const response = page.waitForResponse(r => r.url() === p.requestUrl && r.request().method() === p.method, { timeout: 15000 }).catch(() => undefined);
      try {
        await button.click({ timeout: 5000 });
        const result = await response;
        if (result) record.responseStatus = result.status();
        const body = await result?.json().catch(() => undefined);
        if (typeof body?.code === 'number') record.businessCode = body.code;
        if (typeof body?.data?.applyNo === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(body.data.applyNo)) record.applyNo = body.data.applyNo;
        // HTTP success alone does not prove application success.
        const visible = await page.getByText(p.successText, { exact: true }).waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
        record.state = released && result?.ok() && (record.businessCode===undefined || record.businessCode===200) && visible ? 'verified' : 'unknown';
        record.detail = record.state === 'verified' ? '指定请求收到成功响应且页面显示指定成功文案；业务编号及撤回仍需单独核验。' : '结果待核验；禁止自动再次提交。';
      } catch { record.state = 'unknown'; record.detail = '点击或响应异常；禁止自动再次提交。'; }
      finally {
        released = true; // Close the mutation allowance even if no request was seen.
        await page.screenshot({ path: path.join(evidenceDir, 'after.png'), fullPage: true }).catch(() => undefined);
        record.afterUrl = page.url();
        await save(record);
      }
      return record;
    },
  };
}
