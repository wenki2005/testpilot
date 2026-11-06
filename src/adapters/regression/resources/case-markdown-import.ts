import { createHash } from 'node:crypto';

export type CaseVersionRow = {
    key: string;
    sourceId?: string;
    id?: string;
    title: string;
    expected: string;
    sourcePath: string[];
    manualSteps?: string[];
    structured?: boolean;
};
type Field = 'id' | 'title' | 'module' | 'expected' | 'steps' | 'ignored';
const aliases: Record<Field, string[]> = {
    id: ['编号', 'id', '用例id', '用例编号', '测试用例编号', 'caseid', 'case_id'],
    title: ['标题', '名称', '用例', '用例名称', '用例标题', '测试用例', '测试项', '测试场景', 'title', 'case', 'casename'],
    module: ['模块', '所属模块', '功能模块', '模块名称', 'module', 'modulepath', 'module_path'],
    expected: ['预期', '预期结果', '预期输出', '预期效果', '期望结果', '期望', 'expected', 'expectedresult', 'expected_result'],
    steps: ['步骤', '操作', '操作步骤', '测试步骤', '执行步骤', 'steps', 'manualsteps', 'manual_steps'],
    ignored: ['前置条件', '前提条件', '前置用例', '固定步骤', '优先级', '来源', '测试数据', '备注', '实际结果', '执行结果', '状态'],
};
const plain = (text: string) => text.trim().replace(/\*\*|__/g, '').replace(/^`([^`]+)`$/, '$1').trim();
const fieldName = (text: string): Field | undefined => {
    const name = plain(text).toLowerCase().replace(/\s/g, '');
    return (Object.keys(aliases) as Field[]).find(key => aliases[key].includes(name));
};
const pathParts = (text: string) => plain(text).split(/\s*[>›｜|]\s*|\s+\/\s+/).filter(Boolean);
const headingIdentity = (text: string) => {
    const title = plain(text);
    const match = title.match(/^([A-Za-z0-9][A-Za-z0-9_.:-]{0,79})\s*[|｜]\s*(.+)$/)
        ?? title.match(/^\[([A-Za-z0-9][A-Za-z0-9_.:-]{0,79})\]\s*(.+)$/)
        ?? title.match(/^([A-Za-z][A-Za-z_.-]*\d[A-Za-z0-9_.-]*)\s*(?:[|｜:：]\s*|\s+(?:-\s*)?)(.+)$/)
        ?? title.match(/^(?:测试用例|用例)\s*([A-Za-z0-9][A-Za-z0-9_.-]*)\s*[|｜:：、]\s*(.+)$/);
    return match ? { id: match[1]!, title: match[2]!.trim() } : { title: title.replace(/^(?:测试用例|用例)\s*[：:]\s*/, '') };
};
function cells(line: string): string[] {
    const result: string[] = []; let value = '', escaped = false, ticks = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (escaped) { value += c === '|' ? '|' : '\\' + c; escaped = false; }
        else if (c === '\\') escaped = true;
        else if (c === '`') { let end = i; while (line[end] === '`') end++; const count = end - i; ticks = ticks === count ? 0 : ticks || count; value += '`'.repeat(count); i = end - 1; }
        else if (c === '|' && !ticks) { result.push(value.trim()); value = ''; }
        else value += c;
    }
    if (escaped) value += '\\';
    result.push(value.trim());
    if (line.trim().startsWith('|')) result.shift();
    const trailing = line.trim().match(/(\\*)\|$/);
    if (trailing && trailing[1]!.length % 2 === 0 && !ticks) result.pop();
    return result;
}
type Block = { line: number; depth: number; title: string; id?: string; sourcePath: string[]; moduleProvided?: boolean; expected: string[]; steps: string[]; stepsProvided: boolean; explicit: boolean };

/** Parse human-authored cases, never infer expectations or executable steps from prose. */
export function parseCaseVersionMarkdown(fileName: string, bytes: Uint8Array): CaseVersionRow[] {
    let text: string;
    try {
        const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    } catch { throw Error('Markdown文字编码无法读取，请保存为UTF-8后上传。'); }
    if (text.includes('\0')) throw Error('Markdown包含无效文字，请保存为UTF-8后上传。');
    // YAML metadata is not a case; preserve line numbers for useful errors.
    text = text.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, value => value.replace(/[^\n]/g, ''));
    const lines = text.split('\n'), result: CaseVersionRow[] = [], headings: Array<{ depth: number; title: string }> = [];
    let block: Block | undefined, section: Field | undefined, fence: { mark: string; length: number } | undefined;
    const location = (line: number) => `${fileName}第${line}行`;
    const createBlock = (line: number, title = '', id?: string, depth = 7): Block => ({ line, depth, title, ...(id ? { id } : {}), sourcePath: headings.map(h => h.title), expected: [], steps: [], stepsProvided: false, explicit: !!id });
    const finish = () => {
        if (!block) return;
        const current = block; block = undefined; section = undefined;
        if (!current.explicit && !current.expected.length && !current.stepsProvided) return;
        const expected = current.expected.join('\n').trim(), title = current.title.trim();
        if (!title || !expected) throw Error(`${location(current.line)}${title ? '「' + title + '」' : ''}缺少${title ? '预期结果' : '用例名称'}；请补充后重新预览，不会把说明文字当作预期。`);
        if (current.id && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(current.id)) throw Error(`${location(current.line)}用例编号无效，请使用80字内的英文、数字、点、横线、下划线或冒号。`);
        const key = current.id ? 'markdown:id:' + current.id : 'markdown:case:' + createHash('sha256').update(JSON.stringify([current.sourcePath, title])).digest('hex').slice(0, 24);
        result.push({ key, ...(current.id ? { id: current.id, sourceId: 'markdown:' + current.id } : {}), title, expected, sourcePath: current.sourcePath, structured: true,
            ...(current.stepsProvided ? { manualSteps: current.steps.map(value => value.replace(/^\s*(?:[-*+]\s+|\d+[.、)]\s*)/, '').trim()).filter(Boolean) } : {}) });
        if (result.length > 2000) throw Error('Markdown用例超过2000条，请拆分后上传。');
    };
    const addText = (line: string) => {
        if (section === 'expected') block?.expected.push(line);
        else if (section === 'steps') block?.steps.push(line);
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!, trimmed = line.trim(), marker = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
        if (fence) {
            if (marker && marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
            else addText(line);
            continue;
        }
        if (marker) { fence = { mark: marker[1]![0]!, length: marker[1]!.length }; continue; }
        if (line.includes('|') && i + 1 < lines.length) {
            const header = cells(line), divider = cells(lines[i + 1]!);
            if (header.length > 1 && header.length === divider.length && divider.every(cell => /^:?-{3,}:?$/.test(cell))) {
                const fields = header.map(fieldName), tableIsCases = fields.includes('title') || fields.includes('id') || fields.includes('expected');
                if (tableIsCases && (!fields.includes('title') || !fields.includes('expected'))) throw Error(`${location(i + 1)}用例表格需包含“用例名称”和“预期结果”列，可使用同义列名。`);
                const recognizedFields = fields.filter(field => field && field !== 'ignored');
                if (tableIsCases && new Set(recognizedFields).size !== recognizedFields.length) throw Error(`${location(i + 1)}用例表格存在重复含义的列，请明确每一列的用途。`);
                if (tableIsCases) finish();
                i += 2;
                for (; i < lines.length && lines[i]!.trim() && lines[i]!.includes('|'); i++) {
                    if (!tableIsCases) continue;
                    const values = cells(lines[i]!);
                    if (values.length !== fields.length) throw Error(`${location(i + 1)}表格列数不一致，正文中的竖线请写成\\|。`);
                    if (!values.some(Boolean)) continue;
                    block = createBlock(i + 1); block.explicit = true;
                    for (let n = 0; n < fields.length; n++) {
                        const value = values[n]!.replace(/<br\s*\/?\s*>/gi, '\n').trim();
                        switch (fields[n]) {
                            case 'id': if (value) block.id = plain(value); break;
                            case 'title': block.title = plain(value); break;
                            case 'module': if (value) block.sourcePath = pathParts(value); break;
                            case 'expected': block.expected = value ? [value] : []; break;
                            case 'steps': block.stepsProvided = true; block.steps = value.split('\n'); break;
                        }
                    }
                    finish();
                }
                i--; continue;
            }
        }
        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (heading) {
            const label = fieldName(heading[2]!);
            if (label && ['expected', 'steps', 'ignored'].includes(label)) {
                block ??= createBlock(i + 1, headings.at(-1)?.title ?? '');
                section = label; if (label === 'steps') block.stepsProvided = true;
                continue;
            }
            const depth = heading[1]!.length, identity = headingIdentity(heading[2]!);
            if (block && (block.explicit || block.expected.length || block.stepsProvided) && depth > block.depth && !identity.id) { addText(line); continue; }
            finish();
            while (headings.length && headings.at(-1)!.depth >= depth) headings.pop();
            block = createBlock(i + 1, identity.title, identity.id, depth);
            headings.push({ depth, title: identity.title });
            continue;
        }
        const field = trimmed.replace(/^(?:[-*+]\s+|\d+[.、)]\s+)/, '').match(/^(?:\*\*|__)?([^:：]{1,40}?)(?:\*\*|__)?\s*[:：]\s*(.*)$/);
        const label = field && fieldName(field[1]!);
        if (field && label) {
            const value = field[2]!.replace(/^(?:\*\*|__)\s*/, '').trim();
            if ((label === 'id' && block?.id) || (label === 'title' && block?.expected.length)) finish();
            block ??= createBlock(i + 1);
            if ((label === 'id' || label === 'title') && !block.moduleProvided && !block.explicit && !block.expected.length && !block.stepsProvided)
                block.sourcePath = headings.map(h => h.title);
            if (label === 'id') { block.id = plain(value); block.explicit = true; section = undefined; }
            else if (label === 'title') { block.title = plain(value); block.explicit = true; section = undefined; }
            else if (label === 'module') { block.sourcePath = pathParts(value); block.moduleProvided = true; section = undefined; }
            else { section = label; if (label === 'steps') block.stepsProvided = true; if (value) addText(value); }
            continue;
        }
        addText(line);
    }
    if (fence) throw Error('Markdown存在未闭合的代码块，请补齐后上传。');
    finish();
    if (!result.length) throw Error('未识别到完整用例。支持表格、用例标题分节或“用例名称／操作步骤／预期结果”字段列表；请保留明确的名称和预期结果。');
    const keys = new Set<string>();
    for (const row of result) { if (keys.has(row.key)) throw Error(`Markdown存在重复用例「${row.id ?? row.title}」，请补充唯一编号或模块。`); keys.add(row.key); }
    return result;
}
