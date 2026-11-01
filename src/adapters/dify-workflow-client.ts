import { redactSensitiveExportData } from './document-sensitive-data.js';

export class DifyWorkflowError extends Error {
  constructor(message: string, public workflowRunId?: string, public code = 'workflow_failed') { super(message); }
}

/** Application keys are read only on the server. Never persist upstream bodies. */
export async function callDifyWorkflow(kind: 'prepare' | 'execution', inputs: Record<string, string>, user: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const key = process.env[kind === 'prepare' ? 'TESTPILOT_DIFY_API_KEY' : 'TESTPILOT_DIFY_EXECUTION_API_KEY'];
  if (!key) throw new DifyWorkflowError(`未配置 Dify ${kind === 'prepare' ? '用例整理' : '模块执行'}密钥。`, undefined, 'missing_configuration');
  const base = new URL(process.env.TESTPILOT_DIFY_BASE_URL ?? 'https://api.dify.ai/v1');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new DifyWorkflowError('Dify 服务地址必须是不含凭据的 HTTPS 地址。');
  let response: Response;
  try {
    response = await fetcher(`${base.href.replace(/\/$/, '')}/workflows/run`, {method:'POST', redirect:'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(150000)]) : AbortSignal.timeout(150000), headers:{authorization:`Bearer ${key}`, 'content-type':'application/json'}, body:JSON.stringify({inputs, response_mode:'blocking', user})});
  } catch { throw new DifyWorkflowError(signal?.aborted ? '任务已取消。' : 'Dify 连接失败或超时；可以重试当前阶段。', undefined, 'connection_failed'); }
  if (!response.ok) throw new DifyWorkflowError(`Dify 返回 HTTP ${response.status}；当前阶段未完成。`, undefined, `http_${response.status}`);
  let payload: any;
  try { payload = await response.json(); } catch { throw new DifyWorkflowError('Dify 未返回有效 JSON。'); }
  const workflowRunId = typeof payload.workflow_run_id === 'string' ? payload.workflow_run_id : undefined;
  if (payload.data?.status !== 'succeeded') {
    const reason = /missing identity/.test(String(payload.data?.error)) ? '已发布工作流与输入协议不兼容（missing identity）。' : '工作流节点执行失败，请查看对应的 Dify 运行日志。';
    throw new DifyWorkflowError(`Dify ${reason}`, workflowRunId);
  }
  let output: any;
  try { output = typeof payload.data.outputs?.result === 'string' ? JSON.parse(payload.data.outputs.result) : payload.data.outputs?.result; } catch { throw new DifyWorkflowError('Dify result 不是有效 JSON。', workflowRunId); }
  if (!output || typeof output !== 'object') throw new DifyWorkflowError('Dify 缺少 result 输出。', workflowRunId);
  return {output, workflowRunId, tokens: Number(payload.data.total_tokens ?? 0)};
}

export function cloudSafe<T>(value: T): T { return redactSensitiveExportData(value) as T; }
