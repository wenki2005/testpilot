import { cloudSafe } from '../../integrations/dify/workflow-client.js';
/** Reject an unsafe Dify export instead of silently changing its original expectations. */
export function assertDifyExportSafe(value: unknown): void {
    const hasCredentialInput = (item: unknown): boolean => {
        if (Array.isArray(item))
            return item.some(hasCredentialInput);
        if (!item || typeof item !== 'object')
            return false;
        const step = item as Record<string, unknown>;
        if (typeof step.action === 'string' && /^fill/.test(step.action) && typeof step.value === 'string' && step.value.length > 0
            && /密码|口令|验证码|密钥|令牌|password|passwd|passcode|token|secret|api.?key/i.test(String(step.label ?? step.placeholder ?? '')))
            return true;
        return Object.values(step).some(hasCredentialInput);
    };
    const original = JSON.stringify(value);
    const secrets = [process.env.TESTPILOT_DIFY_API_KEY, process.env.TESTPILOT_DIFY_EXECUTION_API_KEY, process.env.TESTPILOT_DIFY_WECOM_WEBHOOK].filter((v): v is string => !!v && v.length >= 8);
    if (hasCredentialInput(value) || original !== JSON.stringify(cloudSafe(value)) || secrets.some(secret => original.includes(JSON.stringify(secret).slice(1, -1))) || /(?:密码|口令|验证码|密钥|令牌|会话凭据)\s*[:=：]\s*[^\s"\\]+/u.test(original))
        throw Error('用例材料包含凭据，无法在保留原始预期的同时安全导出；请使用不含凭据的来源包。原用例和历史结果未修改。');
}
