import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CaseCodeFile } from '../../../domain/documents/cases/case-code.js';

/** Only named, reviewed files may be viewed. No request-supplied filesystem paths. */
export function createDocumentCaseCodeSource(projectRoot: string) {
  return async (projectId: string, caseId: string): Promise<CaseCodeFile[]> => {
    const files: CaseCodeFile[] = [];
    const executorPath = 'src/adapters/documents/execution/browser-lane.ts';
    try {
      const code = await readFile(path.join(projectRoot, executorPath), 'utf8');
      files.push({ name: 'document-browser-lane.ts', language: 'typescript', path: executorPath, code,
        sha256: createHash('sha256').update(code).digest('hex'), description: '当前测试执行器源码。它解释用例动作并调用共享浏览器、表单和断言辅助函数；导入依赖未合并到单文件。' });
    } catch { /* Packaged distributions may omit source; definitions stay available. */ }
    if (projectId === 'eaf7b01a-51a2-4e66-bb5e-37d662c4306c' && caseId === 'case-10') {
      const relative = '04_项目代码/kaixin-sample-apply/src/views/pc/home/index.vue';
      try {
        const source = await readFile(path.resolve(projectRoot, '..', relative), 'utf8');
        const lines = source.split(/\r?\n/u);
        if (lines[54]?.includes('如有调样、周边产品等样书申请需求，请联系运营OA申请')) {
          files.push({ name: 'index.vue（关联业务代码）', language: 'vue', path: relative, startLine: 50,
            code: lines.slice(49, 60).join('\n'), sha256: createHash('sha256').update(source).digest('hex'),
            description: '已人工核对：PC首页第55行的提示与case-10及页面证据对应。此片段来自当前提供的业务仓库，不证明线上部署版本或历史运行构建一致。' });
        }
      } catch { /* No matching local repository: do not invent an association. */ }
    }
    return files;
  };
}
