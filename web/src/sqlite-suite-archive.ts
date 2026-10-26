import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';

const maxArchiveBytes = 10 * 1024 * 1024;
const maxExpandedBytes = 5 * 1024 * 1024;
const maxEntries = 200;

export async function readSqliteSuiteArchive(file: File): Promise<{ suite: unknown; files: Record<string, string> }> {
  if (file.size === 0 || file.size > maxArchiveBytes) throw new Error('ZIP 不能为空且压缩文件不得超过 10 MB。');
  const input = new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const collected = new Map<string, Uint8Array>();
    let expandedBytes = 0;
    let entries = 0;
    let failed: Error | undefined;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const unzip = new Unzip(entry => {
      entries++;
      if (entries > maxEntries) { failed = new Error('ZIP 文件数量超过 200 个。'); return; }
      const archivePath = entry.name.replaceAll('\\', '/');
      if (archivePath.endsWith('/')) return;
      let relativePath: string | undefined;
      if (archivePath === 'suite-sources/suite.json') relativePath = 'suite.json';
      else if (archivePath.startsWith('suite-sources/')) {
        const candidate = archivePath.slice('suite-sources/'.length);
        if (candidate.toLowerCase().endsWith('.sql')) relativePath = candidate;
      }
      if (!relativePath) return;
      if (relativePath.length > 240 || relativePath.startsWith('/') || /^[a-z]:/i.test(relativePath) || relativePath.split('/').some(part => !part || part === '.' || part === '..') || (relativePath !== 'suite.json' && !relativePath.toLowerCase().endsWith('.sql'))) {
        failed = new Error(`ZIP 包含不安全的套件路径：${relativePath}`); return;
      }
      if (collected.has(relativePath)) { failed = new Error(`ZIP 包含重复文件：${relativePath}`); return; }
      if ((entry.originalSize ?? 0) > maxExpandedBytes) { failed = new Error(`解压文件超过 5 MB：${relativePath}`); return; }
      const chunks: Uint8Array[] = [];
      let size = 0;
      entry.ondata = (error, chunk, final) => {
        if (error) { failed = new Error(`无法解压 ${relativePath}：${error.message}`); return; }
        size += chunk.byteLength; expandedBytes += chunk.byteLength;
        if (size > maxExpandedBytes || expandedBytes > maxExpandedBytes) { failed = new Error('ZIP 解压内容超过 5 MB。'); void entry.terminate(); return; }
        chunks.push(chunk);
        if (final) {
          const merged = new Uint8Array(size); let offset = 0;
          for (const part of chunks) { merged.set(part, offset); offset += part.byteLength; }
          collected.set(relativePath!, merged);
        }
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    try {
      for (let offset = 0; offset < input.length; offset += 64 * 1024) unzip.push(input.subarray(offset, Math.min(offset + 64 * 1024, input.length)), offset + 64 * 1024 >= input.length);
      if (failed) throw failed;
      const suiteBytes = collected.get('suite.json');
      if (!suiteBytes) throw new Error('ZIP 中找不到 suite-sources/suite.json。请选择 TestPilot SQLite 测试脚本包。');
      const suite = JSON.parse(decoder.decode(suiteBytes)) as unknown;
      const files = Object.fromEntries([...collected.entries()].filter(([name]) => name !== 'suite.json').map(([name, bytes]) => [name, decoder.decode(bytes)]));
      if (!Object.keys(files).length) throw new Error('ZIP 中没有找到 SQL 源文件。');
      resolve({ suite, files });
    } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
  });
}
