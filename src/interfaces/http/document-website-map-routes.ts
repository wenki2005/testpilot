import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from './http-utils.js';
import type { createDocumentWebsiteMapService } from '../../application/projects/document-website-map-service.js';
export async function handleDocumentWebsiteMapRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, service: ReturnType<typeof createDocumentWebsiteMapService>, modelAvailable: () => boolean): Promise<boolean> {
  const resolve=pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/website-map\/cases\/([A-Za-z0-9_.:-]{1,80})\/resolve$/u);
  if(resolve) {
    if(req.method!=='POST'){fail(res,405,'method not allowed');return true;}
    try {
      const body=await bodyJson(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length){fail(res,400,'用例页面匹配仅接受空对象，使用项目已有用例和页面地图。');return true;}
      if(!modelAvailable()){fail(res,409,'请先配置AI模型，再匹配用例页面。');return true;}
      json(res,200,await service.resolveCase(resolve[1]!,resolve[2]!));
    }catch(error){fail(res,409,error instanceof Error?error.message:'用例页面匹配失败');}
    return true;
  }
  const verify = pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/website-map\/pages\/([a-f0-9-]{36})\/verify$/iu);
  if (verify) {
    if (req.method !== 'POST') { fail(res, 405, 'method not allowed'); return true; }
    try {
      const body = await bodyJson(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) { fail(res, 400, '路径验证仅接受空对象。'); return true; }
      json(res, 200, await service.verifyPage(verify[1]!, verify[2]!));
    } catch (error) { fail(res, 409, error instanceof Error ? error.message : '路径验证失败'); }
    return true;
  }
  const match = pathname.match(/^\/api\/document-projects\/([A-Za-z0-9_-]{1,128})\/website-map$/u);
  if (!match) return false;
  try {
    if (req.method === 'GET') { json(res, 200, { map: await service.latest(match[1]!) ?? null }); return true; }
    if (req.method !== 'POST') { fail(res, 405, 'method not allowed'); return true; }
    const body = await bodyJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) { fail(res, 400, '网站探索仅接受空对象，目标和账号取自当前项目。'); return true; }
    if (!modelAvailable()) { fail(res, 409, '请先配置 AI 模型，再开始自主探索。'); return true; }
    json(res, 202, { map: await service.start(match[1]!) });
  } catch (error) { fail(res, 409, error instanceof Error ? error.message : '网站探索启动失败'); }
  return true;
}
