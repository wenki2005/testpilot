import type { DocumentRun } from '../../domain/document-test-model.js';

export type NotificationConfig = { enabled: boolean; webhook: string };
export type NotificationReceipt = { eventId: string; runId: string; status: 'pending' | 'delivered' | 'failed'; attempts: number; updatedAt: string };
export type RunNotificationStatus =
  | { status: 'disabled' | 'not-applicable' | 'no-record' }
  | { status: 'pending' | 'delivered' | 'failed'; attempts: number; updatedAt: string };
export interface RunNotificationRepository {
  readConfig(): Promise<NotificationConfig>;
  saveConfig(config: NotificationConfig): Promise<void>;
  readReceipt(eventId: string): Promise<NotificationReceipt | undefined>;
  readReceiptForRun(runId: string): Promise<NotificationReceipt | undefined>;
  saveReceipt(receipt: NotificationReceipt): Promise<void>;
  withEventLock<T>(eventId: string, action: () => Promise<T>): Promise<T>;
}

export class NotificationConfigurationError extends Error {}
export class NotificationDeliveryUncertainError extends Error {}

export function buildRunNotificationSummary(run: DocumentRun): string {
  const results = run.deterministic.results;
  const count = (status: string) => results.filter(item => item.status === status).length;
  // Only stable identifiers are sent: never titles, URLs of the target, or error/page text.
  const caseIds = [...new Set([...results, ...(run.ai?.results ?? [])]
    .filter(item => ['failed', 'blocked', 'cancelled'].includes(item.status))
    .map(item => item.id).filter(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/u.test(id)))];
  const query = new URLSearchParams({ documentProject: run.projectId ?? '', documentRun: run.id });
  return `TestPilot 回归需关注\n运行：${run.id}\n状态：${run.overall}\n脚本：通过 ${count('passed')}，失败 ${count('failed')}，阻塞 ${count('blocked')}，取消 ${count('cancelled')}\n异常用例：${caseIds.slice(0, 8).join('、') || '请在工作台查看'}${caseIds.length > 8 ? `（另有 ${caseIds.length - 8} 条）` : ''}\n本机证据入口：http://127.0.0.1:14418/?${query}#doc-results\n请在运行 TestPilot 的电脑打开；截图与详情仅在本机查看。`;
}
export function validateWecomWebhook(value: unknown): string {
  if (typeof value !== 'string') throw new NotificationConfigurationError('请提供企业微信群机器人 Webhook。');
  let url: URL;
  try { url = new URL(value); } catch { throw new NotificationConfigurationError('Webhook 地址无效。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'qyapi.weixin.qq.com' || url.port || url.username || url.password || url.pathname !== '/cgi-bin/webhook/send' || url.hash || [...url.searchParams.keys()].some(key => key !== 'key') || url.searchParams.getAll('key').length !== 1 || !/^[A-Za-z0-9_-]{8,200}$/u.test(url.searchParams.get('key') ?? '')) {
    throw new NotificationConfigurationError('仅支持企业微信官方机器人 Webhook，且需有效 key。');
  }
  return url.toString();
}

/** Sends only result counts and opaque run identifiers, never page text, credentials or screenshots. */
export function createDocumentRunNotificationService(deps: {
  repository: RunNotificationRepository;
  send(webhook: string, content: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  now(): string;
}) {
  const inFlight = new Map<string, Promise<NotificationReceipt | undefined>>();
  return {
    async getRunStatus(run: DocumentRun): Promise<RunNotificationStatus> {
      const receipt = await deps.repository.readReceiptForRun(run.id);
      if (receipt) return { status: receipt.status, attempts: receipt.attempts, updatedAt: receipt.updatedAt };
      const config = await deps.repository.readConfig();
      if (!config.enabled || !config.webhook) return { status: 'disabled' };
      if (!run.completedAt || run.overall === 'passed') return { status: 'not-applicable' };
      return { status: 'no-record' };
    },
    async getConfig() {
      const config = await deps.repository.readConfig();
      return { enabled: config.enabled, configured: Boolean(config.webhook), destination: config.webhook ? '企业微信群机器人（密钥已隐藏）' : undefined };
    },
    async preview(run: DocumentRun) {
      const config = await this.getConfig();
      const status = await this.getRunStatus(run);
      const applicable = Boolean(run.completedAt && run.overall !== 'passed');
      return { content: buildRunNotificationSummary(run), applicable, enabled: config.enabled,
        configured: config.configured, status, canSend: applicable && config.enabled && config.configured && status.status === 'no-record' };
    },
    async sendOnce(run: DocumentRun, input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => key !== 'authorizeSending')
        || (input as { authorizeSending?: unknown }).authorizeSending !== true) {
        throw new NotificationConfigurationError('试发前请明确确认向已配置的测试群发送本轮摘要。');
      }
      const preview = await this.preview(run);
      if (!preview.applicable) throw new NotificationConfigurationError('仅可发送已经结束且需要关注的运行。');
      if (!preview.enabled || !preview.configured) throw new NotificationConfigurationError('请先配置并启用测试群通知。');
      // A trial shares the terminal event identity with automatic delivery.
      // Existing receipts are returned unchanged, including failed or uncertain ones.
      if (!preview.canSend) return this.getRunStatus(run);
      await this.notify(run);
      return this.getRunStatus(run);
    },
    async configure(input: unknown) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NotificationConfigurationError('通知配置必须为对象。');
      const data = input as Record<string, unknown>;
      if (Object.keys(data).some(key => !['enabled', 'webhook', 'authorizeSending'].includes(key)) || typeof data.enabled !== 'boolean') throw new NotificationConfigurationError('通知配置字段无效。');
      const previous = await deps.repository.readConfig();
      const webhook = data.webhook === undefined ? previous.webhook : validateWecomWebhook(data.webhook);
      if (data.enabled && (!webhook || data.authorizeSending !== true)) throw new NotificationConfigurationError('启用前须明确授权向所配置群机器人发送运行状态摘要。');
      await deps.repository.saveConfig({ enabled: data.enabled, webhook });
      return this.getConfig();
    },
    async notify(run: DocumentRun): Promise<NotificationReceipt | undefined> {
      if (!run.completedAt || run.overall === 'passed') return undefined;
      const eventId = `${run.id}:terminal`;
      const active = inFlight.get(eventId);
      if (active) return active;
      const task = deps.repository.withEventLock(eventId, async () => {
        const config = await deps.repository.readConfig();
        if (!config.enabled || !config.webhook) return undefined;
        validateWecomWebhook(config.webhook);
        const old = await deps.repository.readReceipt(eventId);
        if (old?.status === 'delivered') return old;
        // A persisted pending event may already have reached WeCom before a crash.
        // Do not silently resend it, as the webhook API has no idempotency key.
        if (old?.status === 'pending') return old;
        // The retry budget belongs to the persisted event, including later
        // callbacks or process restarts, rather than each notify() invocation.
        if (old?.status === 'failed' && old.attempts >= 3) return old;
        const content = buildRunNotificationSummary(run);
        let receipt: NotificationReceipt = { eventId, runId: run.id, status: 'pending', attempts: old?.attempts ?? 0, updatedAt: deps.now() };
        const remainingAttempts = Math.max(0, 3 - receipt.attempts);
        for (let attempt = 0; attempt < remainingAttempts; attempt += 1) {
          receipt = { ...receipt, status: 'pending', attempts: receipt.attempts + 1, updatedAt: deps.now() };
          await deps.repository.saveReceipt(receipt);
          try { await deps.send(config.webhook, content); }
          catch (error) {
            // A timeout/disconnect may happen after WeCom accepted the message.
            // Keep the durable pending receipt and never automatically replay it.
            if (error instanceof NotificationDeliveryUncertainError) return receipt;
            receipt = { ...receipt, status: 'failed', updatedAt: deps.now() };
            await deps.repository.saveReceipt(receipt);
            if (attempt < remainingAttempts - 1) { await deps.wait(250 * 2 ** attempt); continue; }
            return receipt;
          }
          // Persistence errors after delivery must not cause an automatic resend.
          receipt = { ...receipt, status: 'delivered', updatedAt: deps.now() };
          await deps.repository.saveReceipt(receipt);
          return receipt;
        }
        return receipt;
      });
      inFlight.set(eventId, task);
      try { return await task; } finally { inFlight.delete(eventId); }
    },
  };
}
