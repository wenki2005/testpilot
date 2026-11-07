import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import type { RunReportDetail } from '../../domain/reports/run-report-contract.js';
import { assertDifyExportSafe } from '../regression/exports/export-policy.js';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const labels: Record<string, string> = { passed: '通过', failed: '失败', blocked: '阻塞', error: '错误', not_executed: '未执行', outside: '范围外' };
/** Portable snapshot; it never imports verdicts or changes the latest case result. */
export async function buildReportArchive(detail: RunReportDetail, readEvidence: (uri: string) => Promise<Uint8Array>) {
    if (['queued', 'running', 'awaiting-login'].includes(detail.report.phase)) throw Error('运行未结束，暂不能归档。');
    assertDifyExportSafe(detail);
    const snapshot = structuredClone(detail), files: Record<string, Uint8Array> = {}, missing: Array<{ path: string; reason: string }> = [], mapped = new Map<string, string>();
    let size = 0;
    for (const step of snapshot.groups.flatMap(g => g.steps)) {
        const uri = step.evidencePath; if (!uri) continue;
        if (!mapped.has(uri)) {
            if (!/^\/api\/(?:dify-web-modules\/jobs|system-module-regression\/core-chains\/runs)\/[a-f0-9-]{36}\/evidence\/[a-f0-9]{64}\.png$/i.test(uri)) throw Error('报告包含无效证据路径。');
            try {
                const bytes = await readEvidence(uri);
                if (bytes.length > 16 * 1024 * 1024 || bytes.length < 8 || Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a') throw Error('PNG内容无效');
                // Legacy screenshot names are opaque evidence IDs, not content hashes.
                const name = 'evidence/' + sha(bytes) + '.png'; if (!files[name]) { size += bytes.length; if (size > 112 * 1024 * 1024) throw Error('报告截图超过112MB'); files[name] = bytes; }
                mapped.set(uri, name);
            } catch (error) {
                if (error instanceof Error && error.message.includes('112MB')) throw error;
                mapped.set(uri, ''); missing.push({ path: uri, reason: '原截图缺失、不可读或PNG内容无效，未替换为其他图片。' });
            }
        }
        step.evidencePath = mapped.get(uri)!;
        if (!step.evidencePath) step.evidenceNote += ' 原截图未归档，见manifest.json。';
    }
    const rows = snapshot.groups.map(g => `<section><h2>${escape(g.title)}</h2><p>${escape(g.version)}</p>${g.steps.map(s => `<article><h3>${escape(s.id)} · ${escape(s.title)}</h3><strong class="${escape(s.status)}">${escape(labels[s.status] ?? s.status)}</strong><h4>预期</h4><p>${escape(s.expected)}</p><h4>实际</h4><p>${escape(s.actual)}</p>${s.nextAction ? `<h4>后续</h4><p>${escape(s.nextAction)}</p>` : ''}${s.evidencePath ? `<a href="${escape(s.evidencePath)}"><img loading="lazy" alt="${escape(s.id)}执行截图" src="${escape(s.evidencePath)}"></a>` : ''}${s.evidenceNote ? `<p>${escape(s.evidenceNote)}</p>` : ''}</article>`).join('')}</section>`).join('');
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.report.name)}</title><style>body{font:15px/1.65 system-ui,sans-serif;color:#17345d;background:#f5f7fb;max-width:1100px;margin:30px auto;padding:0 24px}header,article{background:white;padding:20px;margin:16px 0;border:1px solid #d8e3f3;border-radius:6px}h1{font-size:24px}h2{font-size:20px}h3{font-size:16px}h4{margin-bottom:4px}p{white-space:pre-wrap;overflow-wrap:anywhere}img{max-width:100%;height:auto;border:1px solid #d8e3f3}.passed{color:#00866b}.failed,.error{color:#d33333}.blocked{color:#b45e00}</style><header><h1>${escape(snapshot.report.name)}</h1><p>${escape(snapshot.report.systemName)} · ${escape(snapshot.environment)} · ${escape(snapshot.report.createdAt)}</p><p>批次：${escape(snapshot.report.id)}\n账号：${escape(snapshot.account)}\n${escape(Object.entries(snapshot.report.counts).map(([k,v]) => (labels[k] ?? k) + ' ' + v).join(' · '))}</p><p>${escape(snapshot.message)}</p><p>这是已保存运行的离线快照。截图未归档：${missing.length}。不改变工作台当前结果。</p></header>${rows}</html>`;
    files['index.html'] = strToU8(html); files['report.json'] = strToU8(JSON.stringify(snapshot, null, 2));
    files['README.txt'] = strToU8('解压整个文件夹后打开index.html。report.json保存运行与模块版本快照，evidence保存本批次已有截图。manifest.json列出文件摘要和缺失证据。包不含账号配置或数据库，不能导入为新的通过结果。可整体移交给团队；分享前按团队要求核对报告内容。');
    files['manifest.json'] = strToU8(JSON.stringify({ schema: 1, format: 'testpilot-report-archive', systemId: snapshot.report.systemId, runId: snapshot.report.id, kind: snapshot.report.kind, createdAt: new Date().toISOString(), missingEvidence: missing, evidenceSources: [...mapped].map(([source, archived]) => ({ source, archived })), files: Object.entries(files).map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha(bytes) })) }, null, 2));
    return zipSync(files, { level: 6 });
}
