import { zipSync, strToU8 } from 'fflate';
import type { BatchView } from '../../src/domain/system-module-contract';
import type { BrowserCheck } from '../../src/adapters/document-test-workflow';
import originalTemplate from './department-sample-report-template.json';

export type ReportFormat = 'xlsx' | 'xmind';
type Status = 'passed' | 'failed' | 'blocked' | 'error' | 'not_executed' | 'outside';
type Counts = Record<Status, number>;
type ReportImage = { name: string; bytes: Uint8Array; width: number; height: number };
type ReportRow = {
  moduleId: string; moduleName: string; version: number; caseId: string; priority: string;
  title: string; source: string; sourcePath: string[]; preconditions: string[]; steps: string[];
  expected: string; inScope: boolean; status: Status; actual: string; blocker: string;
  nextAction: string; evidence: string; evidenceNote: string; image?: ReportImage; imageIssue?: string;
};
type ReportData = { batch: BatchView; exportedAt: string; rows: ReportRow[]; counts: Counts };
type CasePack = { cases: BrowserCheck[] };
const apiRoot = '/api/system-module-regression';
const statusLabels: Record<Status, string> = {
  passed: '通过', failed: '失败', blocked: '阻塞', error: '异常', not_executed: '未执行', outside: '范围外',
};
const colors: Record<Status, { text: string; fill: string }> = {
  passed: { text: '087F3F', fill: 'E8FAEF' }, failed: { text: 'D12B20', fill: 'FFF0EE' },
  blocked: { text: 'B54708', fill: 'FFF2DF' }, error: { text: 'D12B20', fill: 'FFF0EE' },
  not_executed: { text: '66738A', fill: 'F5F6F8' }, outside: { text: '596579', fill: 'EEF0F4' },
};
const statuses = Object.keys(statusLabels) as Status[];
const needsScreenshot = (row: ReportRow) => row.inScope && ['failed', 'blocked', 'error'].includes(row.status);
const blockerLabels: Record<string, string> = {
  'write-required': '需要实际提交或写入验证', 'business-clarification': '业务口径待澄清',
  'identity-evidence': '缺少对应账号或角色权限', 'fixture-required': '缺少可验证的数据或集成证据',
  'assertion-incomplete': '测试步骤或结果检查尚未补齐', 'steps-missing': '缺少可执行步骤',
  'legacy-review': '原导入用例待复核', 'prerequisite-required': '前置条件未满足',
};
const blockerLabel = (value: string) => blockerLabels[value] ?? value;
const caseSteps = (row: ReportRow) => row.steps.map((step, i) => `${i + 1}. ${step}`).join('\n') || '原导入用例未单列操作步骤，测试场景见原始来源路径。';
const casePreconditions = (row: ReportRow) => row.preconditions.join('\n') || '原导入用例未单列前置条件。';
const screenshotDescription = (row: ReportRow) => [
  row.image ? '本批次截图已嵌入报告，可离线查看。' : needsScreenshot(row) ? row.imageIssue || '本批次未保存该用例的截图。' : '',
  row.evidenceNote,
].filter(Boolean).join('\n');
const emptyCounts = (): Counts => ({ passed: 0, failed: 0, blocked: 0, error: 0, not_executed: 0, outside: 0 });
function countRows(rows: ReportRow[]): Counts {
  const counts = emptyCounts();
  for (const row of rows) if (row.inScope) counts[row.status]++;
  return counts;
}
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const scopeLabel = (batch: BatchView) => ({ starter: '日常用例', all: '全部用例', custom: '自选用例', core: '历史核心用例' }[batch.scope ?? 'all']);
const phaseLabel = (batch: BatchView) => ({ queued: '等待开始', running: '运行中快照（结果尚未完整）', completed: '本轮结束', cancelled: '已取消', interrupted: '未完成' }[batch.phase]);

async function request(path: string, text = false): Promise<any> {
  const response = await fetch(apiRoot + path, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    let reason = '报告资料读取失败，请重试。';
    try { reason = (await response.json()).error ?? reason; } catch { /* Keep the readable fallback. */ }
    throw new Error(reason);
  }
  return text ? response.text() : response.json();
}

/** Read human instructions from the existing, export-checked Markdown version. */
function manualSteps(markdown: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  let current = ''; let section = ''; let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim().startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^##\s+([^\s|｜]+)\s*[|｜]/);
    if (heading) { current = heading[1]!; section = ''; continue; }
    const subheading = line.match(/^###\s+(.+)$/);
    if (subheading) { section = subheading[1]!.trim(); continue; }
    if (current && /^(操作步骤|步骤)$/.test(section) && line.trim()) {
      const instructions = result.get(current) ?? [];
      instructions.push(line.replace(/^\s*(?:[-*]|\d+[.、])\s*/, '').trim());
      result.set(current, instructions);
    }
  }
  return result;
}

function describeStep(step: BrowserCheck['steps'][number]): string {
  const value = step as unknown as Record<string, unknown>;
  const actions: Record<string, string> = {
    navigate: '打开页面', goto: '打开页面', click: '点击', clickByText: '点击文字', clickByRole: '点击控件',
    fill: '填写', fillByLabel: '填写字段', fillByPlaceholder: '填写输入框', select: '选择', selectOption: '选择选项',
    assertText: '检查文字', assertVisible: '检查可见内容', assertNotVisible: '检查内容未显示',
    assertExactVisible: '检查完整文字', assertRoleVisible: '检查控件可见', assertValue: '检查字段值',
    assertValueByPlaceholder: '检查输入值', assertDisabled: '检查控件禁用', assertRoleDisabled: '检查控件禁用',
    assertFieldInvalid: '检查字段校验', assertMaxLengthOrMessage: '检查长度限制或提示',
    assertNoHorizontalOverflow: '检查页面没有横向溢出', assertNoFetchOrXhr: '检查没有发送业务请求',
    assertCurrentUrlUnchanged: '检查页面地址未改变', wait: '等待', waitForText: '等待文字出现', press: '按键',
    fillByRoleIndex: '填写指定输入框', blurByLabel: '移开字段焦点', blurByPlaceholder: '移开输入框焦点',
    selectByLabel: '选择字段值', selectByPlaceholder: '选择输入框选项', selectByRoleIndex: '选择指定下拉框选项',
    clickExactText: '点击完整文字', captureCurrentUrl: '记录当前页面地址',
  };
  const details = Object.entries(value).filter(([key]) => key !== 'action').map(([key, item]) => {
    const label = ({ text: '文字', label: '字段', name: '名称', role: '控件', value: '值', url: '地址', placeholder: '提示', selector: '定位', key: '按键', rowIndex: '行序号（从0起）', index: '控件序号（从0起）', maxLength: '最大长度', message: '提示文案', quietMs: '无请求观察时长（毫秒）' } as Record<string, string>)[key] ?? key;
    return `${label}：${typeof item === 'string' ? item : JSON.stringify(item)}`;
  }).join('；');
  return `${actions[String(value.action)] ?? String(value.action)}${details ? ' · ' + details : ''}`;
}

async function loadReport(batchId: string): Promise<ReportData> {
  // Keep the existing server export policies as gates for both actual results and original materials.
  const [batch] = await Promise.all([request(`/batches/${batchId}`), request(`/batches/${batchId}/report`, true)]) as [BatchView, string];
  const rows: ReportRow[] = [];
  for (const entry of batch.entries) {
    const query = `?version=${encodeURIComponent(entry.versionId)}`;
    const [pack, markdown] = await Promise.all([
      request(`/modules/${entry.moduleId}${query}`), request(`/modules/${entry.moduleId}/markdown${query}`, true),
    ]) as [CasePack, string];
    const instructions = manualSteps(markdown);
    const job = batch.jobs.find(item => item.id === entry.jobId);
    const selected = new Set(entry.selectedCaseIds ?? job?.selectedCaseIds ?? pack.cases.map(item => item.id));
    const results = new Map(job?.results.map(result => [result.caseId, result]) ?? []);
    const known = new Set(pack.cases.map(item => item.id));
    if ([...selected].some(id => !known.has(id)) || [...results.keys()].some(id => !known.has(id))) {
      throw new Error('本批次结果与用例版本不一致，已停止导出，请核对原始用例版本。');
    }
    for (const item of pack.cases) {
      const inScope = selected.has(item.id);
      const result = inScope ? results.get(item.id) : undefined;
      const status: Status = result?.outOfScope ? 'outside' : result?.status ?? 'not_executed';
      const sourcePath = item.source.split(/\s*›\s*/).filter(Boolean);
      if (/\.xmind$/i.test(sourcePath[0] ?? '')) sourcePath.shift();
      rows.push({
        moduleId: entry.moduleId, moduleName: entry.moduleName, version: entry.version, caseId: item.id,
        priority: item.priority ?? '', title: item.title, source: item.source,
        sourcePath: sourcePath.length > 1 ? sourcePath : [...(item.modulePath ?? [entry.moduleName]), item.title],
        preconditions: item.preconditions ?? [], steps: instructions.get(item.id)?.length ? instructions.get(item.id)! : item.steps.map(describeStep),
        expected: item.expected, inScope, status,
        actual: !inScope ? '未纳入本轮执行范围。' : result?.detail || '本批次尚无该用例的执行结果。',
        blocker: result?.blockerCode ?? '', nextAction: result?.nextAction ?? '',
        evidence: result?.evidence && job ? new URL(`/api/dify-web-modules/jobs/${encodeURIComponent(job.id)}/evidence/${encodeURIComponent(result.evidence)}`, location.origin).href : '',
        evidenceNote: [result?.evidenceNote, result?.evidenceOrigin === 'preflight' ? '运行准备截图，不代表该用例已实际执行。' : ''].filter(Boolean).join('\n'),
      });
    }
  }
  await embedScreenshots(rows);
  return { batch, exportedAt: new Date().toISOString(), rows, counts: countRows(rows) };
}

/** Fetch only this batch's existing evidence. Never capture a different page as a replacement. */
async function embedScreenshots(rows: ReportRow[]): Promise<void> {
  const cache = new Map<string, Promise<ReportImage>>();
  const pending = rows.filter(needsScreenshot);
  let cursor = 0; let totalBytes = 0;
  async function readImage(url: string, name: string): Promise<ReportImage> {
    const target = new URL(url);
    if (target.origin !== location.origin || !/^\/api\/dify-web-modules\/jobs\/[^/]+\/evidence\/[^/]+$/.test(target.pathname)) throw new Error('证据地址不属于当前批次的截图接口。');
    const response = await fetch(target.href, { cache: 'no-store', signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw new Error(`截图读取失败（HTTP ${response.status}），请恢复证据后重新下载。`);
    if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('截图超过8MB，未能嵌入；可通过原始截图链接查看。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('截图超过8MB，未能嵌入；可通过原始截图链接查看。');
    if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('证据文件不是有效的PNG截图，未能嵌入。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height) throw new Error('截图尺寸无效，未能嵌入。');
    if (totalBytes + bytes.length > 96 * 1024 * 1024) throw new Error('本报告截图总量超过96MB，后续截图保留原始链接。');
    totalBytes += bytes.length;
    return { name, bytes, width, height };
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length) {
      const index = cursor++; const row = pending[index]!;
      if (!row.evidence) { row.imageIssue = '本批次未保存该用例的截图，无法补贴。'; continue; }
      let image = cache.get(row.evidence);
      if (!image) { image = readImage(row.evidence, `evidence-${index + 1}.png`); cache.set(row.evidence, image); }
      try { row.image = await image; }
      catch (error) { row.imageIssue = error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'TypeError' ? error.message : '截图读取超时或连接失败，请检查本机服务后重新下载。'; }
    }
  }));
}

function metadata(data: ReportData): Array<[string, string | number]> {
  const { batch, rows } = data;
  return [
    ['系统', batch.systemName], ['批次编号', batch.id], ['测试账号', batch.accountName ?? '历史默认账号'],
    ['环境', batch.environment], ['被测地址', batch.targetUrl], ['执行范围', scopeLabel(batch)],
    ['批次状态', phaseLabel(batch)], ['运行开始时间（北京时间）', time(batch.createdAt)],
    ['导出时间（北京时间）', time(data.exportedAt)], ['本轮选择用例数', rows.filter(row => row.inScope).length],
    ['模块版本全部用例数', rows.length], ['未纳入本轮用例数', rows.filter(row => !row.inScope).length],
    ['统计口径', '统计仅包含本轮选择的用例；明细保留这些模块的全部版本用例，未纳入本轮的标为未执行，不计入本轮汇总。'],
    ['截图说明', '失败、阻塞及异常用例的已有截图嵌入文件，可离线查看；缺失或读取失败逐条注明。前置现场截图不代表业务步骤已执行。'],
    ['截图收录', `需附图 ${rows.filter(needsScreenshot).length} 条；已嵌入 ${rows.filter(row => needsScreenshot(row) && row.image).length} 条；缺失或读取失败 ${rows.filter(row => needsScreenshot(row) && !row.image).length} 条。`],
  ];
}

type ReportField = { key: string; label: string; value: string; link?: string };
/** Both file formats render this same complete field list, including evidence explanations. */
function caseFields(row: ReportRow): ReportField[] {
  return [
    { key: 'module', label: '模块', value: row.moduleName },
    { key: 'version', label: '模块版本', value: `v${row.version}` },
    { key: 'id', label: '用例编号', value: row.caseId },
    { key: 'priority', label: '优先级', value: row.priority || '原用例未标注' },
    { key: 'title', label: '用例标题', value: row.title },
    { key: 'source', label: '原始来源路径', value: row.source },
    { key: 'preconditions', label: '前置条件', value: casePreconditions(row) },
    { key: 'steps', label: '操作步骤', value: caseSteps(row) },
    { key: 'expected', label: '原始预期结果', value: row.expected },
    { key: 'scope', label: '本轮执行范围', value: row.inScope ? '纳入本轮' : '未纳入本轮' },
    { key: 'status', label: '本轮结果', value: statusLabels[row.status] },
    { key: 'actual', label: '实际结果', value: row.actual },
    { key: 'blocker', label: '阻塞类别', value: row.blocker ? blockerLabel(row.blocker) : '本批次未记录阻塞类别' },
    { key: 'nextAction', label: '处理建议', value: row.nextAction || '本批次未记录处理建议' },
    { key: 'evidence', label: '截图证据', value: row.image ? '本批次截图已嵌入报告；可通过链接查看原图。' : row.evidence ? '原始截图链接；嵌入情况见证据说明。' : '本批次未保存截图。', ...(row.evidence ? { link: row.evidence } : {}) },
    { key: 'evidenceNote', label: '证据说明', value: screenshotDescription(row) || '本批次未记录额外证据说明' },
  ];
}

function moduleSummaries(data: ReportData) {
  return data.batch.entries.map(entry => {
    const rows = data.rows.filter(row => row.moduleId === entry.moduleId);
    return { name: entry.moduleName, version: `v${entry.version}`, selected: rows.filter(row => row.inScope).length, counts: countRows(rows) };
  });
}

const xml = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
function column(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
type Cell = string | number | { value: string | number; style?: number; link?: string };
type Sheet = { name: string; rows: Cell[][]; widths: number[]; header: number; freezeColumns?: number; filter?: boolean; merges?: string[]; pictures?: Array<{ row: number; image: ReportImage; label: string; width: number; height: number }> };
const statusStyle = (status: Status) => 4 + statuses.indexOf(status);

/** Standard OOXML, written as inline text: case text can never become an Excel formula. */
function excel(data: ReportData): Uint8Array {
  const summaryRows: Cell[][] = [[{ value: `${data.batch.systemName} · 测试报告`, style: 1 }], ...metadata(data).map(([key, value]) => [{ value: key, style: 3 }, value])];
  summaryRows.push([], [{ value: '本轮结果汇总', style: 2 }], statuses.map(status => ({ value: statusLabels[status], style: statusStyle(status) })), statuses.map(status => data.counts[status]), []);
  const moduleHeader = summaryRows.length + 1;
  summaryRows.push(['模块', '版本', '本轮用例', ...statuses.map(status => statusLabels[status])].map(value => ({ value, style: 2 })));
  for (const entry of moduleSummaries(data)) {
    summaryRows.push([entry.name, entry.version, entry.selected, ...statuses.map(status => entry.counts[status])]);
  }
  const headers = data.rows[0] ? caseFields(data.rows[0]).map(field => field.label) : ['用例明细'];
  const detailRows: Cell[][] = [headers.map(value => ({ value, style: 2 })), ...data.rows.map(row => caseFields(row).map(field => ({
    value: field.value, ...(field.key === 'status' ? { style: statusStyle(row.status) } : {}), ...(field.link ? { link: field.link, style: 10 } : {}),
  })))];
  const sheets: Sheet[] = [
    { name: '执行汇总', rows: summaryRows, widths: [34, 45, 18, 18, 18, 18, 18, 18, 18], header: moduleHeader, merges: ['A1:I1', ...metadata(data).map((_, i) => `B${i + 2}:I${i + 2}`)] },
    { name: '用例明细', rows: detailRows, widths: [25, 12, 20, 10, 46, 64, 40, 66, 66, 18, 14, 70, 27, 50, 20, 46], header: 1, freezeColumns: 3, filter: true },
  ];
  const issues: Sheet = { name: '失败与阻塞', rows: [], widths: [22, 24, 20, 20, 20, 20, 20, 20], header: 1, merges: [], pictures: [] };
  for (const row of data.rows.filter(needsScreenshot)) {
    issues.rows.push([{ value: `${row.caseId} · ${statusLabels[row.status]} · ${row.title}`, style: statusStyle(row.status) }]);
    issues.merges!.push(`A${issues.rows.length}:H${issues.rows.length}`);
    issues.rows.push([{ value: '截图说明', style: 3 }, screenshotDescription(row)]);
    issues.merges!.push(`B${issues.rows.length}:H${issues.rows.length}`);
    if (row.image) {
      const scale = Math.min(1, 960 / row.image.width, 780 / row.image.height);
      const width = Math.round(row.image.width * scale), height = Math.round(row.image.height * scale);
      issues.pictures!.push({ row: issues.rows.length, image: row.image, label: `${row.caseId} ${statusLabels[row.status]}截图`, width, height });
      // Empty evidence rows are 42pt (56px); reserve enough room without cropping the image.
      for (let i = 0; i < Math.ceil(height / 56) + 1; i++) issues.rows.push([]);
    }
    for (const field of caseFields(row)) {
      issues.rows.push([{ value: field.label, style: 3 }, { value: field.value, ...(field.link ? { link: field.link, style: 10 } : {}) }]);
      issues.merges!.push(`B${issues.rows.length}:H${issues.rows.length}`);
    }
    if (row.evidence) issues.rows.push(['原始截图链接', { value: '在本机查看原始截图', link: row.evidence, style: 10 }]);
    issues.rows.push([]);
  }
  if (!issues.rows.length) issues.rows.push(['本轮没有失败、阻塞或异常用例。']);
  sheets.push(issues);
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, content: string) => { files[name] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + content); };
  const spreadsheetNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationshipNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const officeNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  put('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((sheet, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${sheet.pictures?.length ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ''}`).join('')}</Types>`);
  put('_rels/.rels', `<Relationships xmlns="${relationshipNS}"><Relationship Id="rId1" Type="${officeNS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const openingSheet = data.rows.some(needsScreenshot) ? sheets.indexOf(issues) : 0;
  put('xl/workbook.xml', `<workbook xmlns="${spreadsheetNS}" xmlns:r="${officeNS}"><bookViews><workbookView activeTab="${openingSheet}"/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  put('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${relationshipNS}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${officeNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${officeNS}/styles" Target="styles.xml"/></Relationships>`);
  const font = (color: string, bold = false, size = 11, underline = false) => `<font><sz val="${size}"/><color rgb="FF${color}"/><name val="Microsoft YaHei"/>${bold ? '<b/>' : ''}${underline ? '<u/>' : ''}</font>`;
  const fill = (color: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`;
  const xf = (fontId: number, fillId: number, center = false) => `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"${center ? ' horizontal="center"' : ''}/></xf>`;
  put('xl/styles.xml', `<styleSheet xmlns="${spreadsheetNS}"><fonts count="11">${font('18263D')}${font('FFFFFF', true, 18)}${font('18263D', true)}${font('526078', true)}${statuses.map(status => font(colors[status].text, true)).join('')}${font('1964F7', false, 11, true)}</fonts><fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('1964F7')}${fill('F0F3F8')}${statuses.map(status => fill(colors[status].fill)).join('')}</fills><borders count="2"><border/><border><left/><right/><top/><bottom style="thin"><color rgb="FFE5E9F0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11">${xf(0, 0)}${xf(1, 2)}${xf(2, 3)}${xf(3, 3)}${statuses.map((_, i) => xf(i + 4, i + 4, true)).join('')}${xf(10, 0)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((sheet, sheetIndex) => {
    const links: Array<{ ref: string; url: string }> = [];
    const sheetRows = sheet.rows.map((row, rowIndex) => {
      const cells = row.map((cell, colIndex) => {
        const item = typeof cell === 'object' ? cell : { value: cell };
        const ref = `${column(colIndex)}${rowIndex + 1}`;
        if (item.link) links.push({ ref, url: item.link });
        if (String(item.value).length > 32767) throw new Error(`用例文字超过 Excel 单元格长度限制，请改用 XMind 导出（${sheet.name} ${ref}）。`);
        return typeof item.value === 'number' ? `<c r="${ref}" s="${item.style ?? 0}"><v>${item.value}</v></c>` : `<c r="${ref}" s="${item.style ?? 0}" t="inlineStr"><is><t xml:space="preserve">${xml(item.value)}</t></is></c>`;
      }).join('');
      const wrappedLines = Math.max(1, ...row.map((cell, i) => {
        const merged = sheet.merges?.find(ref => ref.startsWith(`${column(i)}${rowIndex + 1}:`));
        const end = merged?.split(':')[1]?.match(/^[A-Z]+/)?.[0];
        const last = end ? sheet.widths.findIndex((_, index) => column(index) === end) : i;
        const width = sheet.widths.slice(i, last + 1).reduce((sum, value) => sum + value, 0) || 30;
        return String(typeof cell === 'object' ? cell.value : cell).split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length * 1.8 / width)), 0);
      }));
      const height = Math.min(409, Math.max(rowIndex === 0 ? sheetIndex === 0 ? 38 : 30 : sheetIndex === 0 ? 32 : 42, wrappedLines * 16 + 10));
      return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells}</row>`;
    }).join('');
    const bottom = sheet.rows.length;
    const freeze = sheetIndex === 1 ? `<pane xSplit="${sheet.freezeColumns}" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/>` : '';
    const pictures = sheet.pictures ?? [];
    put(`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<worksheet xmlns="${spreadsheetNS}" xmlns:r="${officeNS}"><dimension ref="A1:${column(sheet.widths.length - 1)}${bottom}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"${sheetIndex === openingSheet ? ' tabSelected="1"' : ''}>${freeze}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${sheetRows}</sheetData>${sheet.filter ? `<autoFilter ref="A${sheet.header}:${column(sheet.widths.length - 1)}${bottom}"/>` : ''}${sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}${links.length ? `<hyperlinks>${links.map((link, i) => `<hyperlink ref="${link.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : ''}${pictures.length ? '<drawing r:id="rDrawing"/>' : ''}</worksheet>`);
    if (links.length || pictures.length) put(`xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`, `<Relationships xmlns="${relationshipNS}">${links.map((link, i) => `<Relationship Id="rId${i + 1}" Type="${officeNS}/hyperlink" Target="${xml(link.url)}" TargetMode="External"/>`).join('')}${pictures.length ? `<Relationship Id="rDrawing" Type="${officeNS}/drawing" Target="../drawings/drawing${sheetIndex + 1}.xml"/>` : ''}</Relationships>`);
    if (pictures.length) {
      put(`xl/drawings/drawing${sheetIndex + 1}.xml`, `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${officeNS}">${pictures.map((picture, i) => `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${picture.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${picture.width * 9525}" cy="${picture.height * 9525}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="${xml(picture.label)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${picture.width * 9525}" cy="${picture.height * 9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`);
      put(`xl/drawings/_rels/drawing${sheetIndex + 1}.xml.rels`, `<Relationships xmlns="${relationshipNS}">${pictures.map((picture, i) => `<Relationship Id="rId${i + 1}" Type="${officeNS}/image" Target="../media/${picture.image.name}"/>`).join('')}</Relationships>`);
      for (const picture of pictures) files[`xl/media/${picture.image.name}`] = picture.image.bytes;
    }
  });
  return zipSync(files, { level: 6 });
}

type Topic = { id: string; class: string; title: string; children?: { attached?: Topic[]; detached?: Topic[] }; labels?: string[]; notes?: { plain?: { content: string } }; style?: { id: string; properties: Record<string, string> }; [key: string]: unknown };
const topic = (title: string, children?: Topic[], note?: string): Topic => ({ id: crypto.randomUUID(), class: 'topic', title, ...(children?.length ? { children: { attached: children } } : {}), ...(note ? { notes: { plain: { content: note } } } : {}) });
const pathKey = (parts: string[]) => JSON.stringify(parts.map(part => part.trim().normalize('NFC')));

function annotate(node: Topic, row: ReportRow): void {
  const label = statusLabels[row.status];
  const palette = colors[row.status];
  node.labels = [...new Set([...(node.labels ?? []), `${label} · ${row.caseId}${row.inScope ? '' : ' · 未纳入本轮'}`])];
  node.style = { id: crypto.randomUUID(), properties: { ...(node.style?.properties ?? {}), 'svg:fill': '#' + palette.fill, 'fo:color': '#' + palette.text } };
  const fields = caseFields(row).map(field => {
    const child = topic(`${field.label}：${field.value}`, field.key === 'steps' && row.steps.length ? row.steps.map((step, i) => topic(`${i + 1}. ${step}`)) : undefined, field.value);
    if (field.link) child.href = field.link;
    if (field.key === 'evidence' && row.image) {
      const scale = Math.min(1, 720 / row.image.width, 600 / row.image.height);
      child.image = { src: `xap:resources/${row.image.name}`, width: Math.round(row.image.width * scale), height: Math.round(row.image.height * scale) };
    }
    return child;
  });
  const result = topic(`本轮结果：${label} · ${row.caseId}`, fields);
  if (!needsScreenshot(row)) result.branch = 'folded';
  node.children = { ...node.children, attached: [...(node.children?.attached ?? []), result] };
}

/** Keep the imported topic hierarchy, IDs and sheet properties; results are new child topics. */
function xmind(data: ReportData): Uint8Array {
  const sheet = structuredClone(originalTemplate.sheet) as unknown as { id: string; class: string; title: string; rootTopic: Topic; [key: string]: unknown };
  if (!data.rows.some(row => row.source.split(/\s*›\s*/)[0] === originalTemplate.sourceFileName)) {
    sheet.id = crypto.randomUUID(); sheet.rootTopic = topic(data.batch.systemName);
  }
  const originalRoot = sheet.rootTopic;
  const matches = new Map<string, ReportRow[]>();
  for (const row of data.rows) {
    const key = pathKey(row.sourcePath);
    matches.set(key, [...(matches.get(key) ?? []), row]);
  }
  const consumed = new Set<ReportRow>();
  function prune(node: Topic, parents: string[]): Topic | undefined {
    const path = [...parents, node.title];
    const rows = matches.get(pathKey(path.slice(1))) ?? matches.get(pathKey(path));
    if (rows?.length) { for (const row of rows) { annotate(node, row); consumed.add(row); } return node; }
    const attached = (node.children?.attached ?? []).flatMap(child => { const kept = prune(child, path); return kept ? [kept] : []; });
    const detached = (node.children?.detached ?? []).flatMap(child => { const kept = prune(child, path); return kept ? [kept] : []; });
    if (!attached.length && !detached.length && parents.length) return undefined;
    node.children = { ...(attached.length ? { attached } : {}), ...(detached.length ? { detached } : {}) };
    return node;
  }
  const root = prune(originalRoot, [])!;
  root.children ??= {}; root.children.attached ??= [];
  for (const row of data.rows) if (!consumed.has(row)) {
    let parent = root;
    const parts = row.sourcePath[0] === root.title ? row.sourcePath.slice(1) : row.sourcePath;
    for (const part of parts) {
      parent.children ??= {}; parent.children.attached ??= [];
      let child = parent.children.attached.find(item => item.title === part);
      if (!child) { child = topic(part); parent.children.attached.push(child); }
      parent = child;
    }
    annotate(parent, row);
  }
  root.children.attached.unshift(topic('本轮报告说明', [
    ...metadata(data).map(([key, value]) => topic(`${key}：${value}`)),
    topic('本轮结果汇总', statuses.map(status => topic(`${statusLabels[status]}：${data.counts[status]}`))),
    topic('模块结果汇总', moduleSummaries(data).map(entry => topic(`${entry.name} · ${entry.version}`, [
      topic(`本轮用例：${entry.selected}`), ...statuses.map(status => topic(`${statusLabels[status]}：${entry.counts[status]}`)),
    ]))),
  ]));
  sheet.title = `${data.batch.systemName} · ${scopeLabel(data.batch)} · ${time(data.batch.createdAt)}`;
  const files: Record<string, Uint8Array> = {};
  const entries: Record<string, object> = { 'content.json': {}, 'metadata.json': {} };
  for (const row of data.rows) if (row.image) {
    const name = `resources/${row.image.name}`;
    files[name] = row.image.bytes; entries[name] = {};
  }
  return zipSync({
    ...files,
    'content.json': strToU8(JSON.stringify([sheet])),
    'metadata.json': strToU8(JSON.stringify({ ...originalTemplate.metadata, creator: { name: 'TestPilot', version: '0.3.0' } })),
    'manifest.json': strToU8(JSON.stringify({ 'file-entries': entries })),
  }, { level: 6 });
}

export async function downloadRegressionReport(batchId: string, format: ReportFormat): Promise<void> {
  const data = await loadReport(batchId);
  const bytes = format === 'xlsx' ? excel(data) : xmind(data);
  const mime = format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.xmind.workbook';
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  const name = `${data.batch.systemName}-详细报告含截图-${scopeLabel(data.batch)}-${data.batch.createdAt.slice(0, 10)}-${data.batch.id.slice(0, 8)}`.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  link.download = `${name}.${format}`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
