import { createHash } from 'node:crypto';

type Priority = 'P0' | 'P1' | 'P2' | 'P3';
type TreeCase = { key: string; title: string; expected: string; sourcePath: string[]; priority: Priority };
type Node = { indent: number; text: string; parents: string[]; children: boolean };

/** XMind-style Markdown: ancestors are navigation/context, marked leaves are expectations.
 * Emoji are author labels, never execution results. Other code languages remain literal. */
export function parseMarkdownCaseTree(text: string): TreeCase[] {
    const nodes: Node[] = [], stack: Node[] = [];
    let fence: { mark: string; length: number; readable: boolean } | undefined;
    for (const line of text.split('\n')) {
        const marker = line.trim().match(/^(`{3,}|~{3,})(.*)$/);
        if (marker) {
            if (fence) {
                if (marker[1]![0] === fence.mark && marker[1]!.length >= fence.length && !marker[2]!.trim()) { fence = undefined; stack.length = 0; }
            } else { fence = { mark: marker[1]![0]!, length: marker[1]!.length, readable: /^(?:markdown|md|text)?$/i.test(marker[2]!.trim()) }; stack.length = 0; }
            continue;
        }
        if (fence && !fence.readable) continue;
        const bullet = line.match(/^(\s*)(?:[-*+]\s+)(.+)$/);
        if (!bullet) { if (line.trim() && !/^\s/.test(line)) stack.length = 0; continue; }
        const indent = bullet[1]!.replaceAll('\t', '    ').length;
        while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
        if (stack.length > 40 || nodes.length >= 20000) throw Error('Markdown树节点过多或层级过深，请拆分后上传。');
        const node: Node = { indent, text: bullet[2]!.trim(), parents: stack.map(item => item.text), children: false };
        if (stack.length) stack.at(-1)!.children = true;
        nodes.push(node); stack.push(node);
    }
    const result: TreeCase[] = [];
    for (const node of nodes) {
        if (node.children || !node.parents.length || /^\/\//.test(node.text)) continue;
        const marked = node.text.replace(/^\[[ xX]\]\s*/, '').replace(/^[\s✅❌⚠️🔄☑️❎🟢🔴]+/u, '');
        const match = marked.match(/^(P[0-3])\s+([\s\S]+)$/i);
        if (!match) continue;
        const expected = match[2]!.trim();
        if (!expected) continue;
        const sourcePath = node.parents, title = sourcePath.at(-1)! + ' — ' + expected;
        const key = 'markdown:tree:' + createHash('sha256').update(JSON.stringify([sourcePath, expected])).digest('hex').slice(0, 24);
        result.push({ key, title, expected, sourcePath, priority: match[1]!.toUpperCase() as Priority });
        if (result.length > 2000) throw Error('Markdown用例超过2000条，请拆分后上传。');
    }
    return result;
}
