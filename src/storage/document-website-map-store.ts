import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import type { WebsiteMapRepository } from '../application/projects/document-website-map-service.js';
import type { WebsiteMap } from '../domain/document-website-map.js';
export function createDocumentWebsiteMapStore(directory: string): WebsiteMapRepository {
  const safeId = /^[a-f0-9-]{36}$/iu;
  async function get(id: string): Promise<WebsiteMap | undefined> {
    if (!safeId.test(id)) return undefined;
    try {
      const map = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')) as WebsiteMap;
      return map.id === id && Array.isArray(map.pages) && Array.isArray(map.edges) ? map : undefined;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  return { get, async save(map) {
    if (!safeId.test(map.id)) throw new Error('网站地图 ID 无效。');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `${map.id}.json`); const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(map), { encoding: 'utf8', mode: 0o600 }); await rename(temporary, file);
  }, async latest(projectId) {
    const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const maps = (await Promise.all(files.filter(f => f.endsWith('.json')).map(f => get(f.slice(0, -5))))).filter((map): map is WebsiteMap => map?.projectId === projectId);
    return maps.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  } };
}
