import type { IncomingMessage, ServerResponse } from 'node:http';
import { bodyJson, fail, json } from '../shared/http-utils.js';

export interface SettingsRouteDependencies {
  readModelSettingsForUi(): unknown;
  resolveModelSettings(): { apiKey?: string };
  saveModelSettings(value: unknown): Promise<unknown>;
  testModelConnection(settings: unknown): Promise<unknown>;
  computerUseConfiguration(): { available: boolean; [key: string]: unknown };
  testComputerUseCapability(): Promise<unknown>;
  testBrowserCdpConnection(): Promise<unknown>;
  getBrowserRuntimeStatus(): Promise<unknown>;
}

export async function handleSettingsRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, deps: SettingsRouteDependencies): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/settings') {
    json(res, 200, { ...((deps.readModelSettingsForUi() as object) ?? {}), computerUse: deps.computerUseConfiguration() });
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/settings') {
    let data: unknown;
    try { data = await bodyJson(req); } catch (error) { fail(res, 400, String((error as Error).message)); return true; }
    try { await deps.saveModelSettings(data); json(res, 200, { ...((deps.readModelSettingsForUi() as object) ?? {}), computerUse: deps.computerUseConfiguration() }); }
    catch (error) { fail(res, 422, error instanceof Error ? error.message : '设置无效。'); }
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/settings/test') {
    try {
      const result = await deps.testModelConnection(deps.resolveModelSettings());
      let computerUse = deps.computerUseConfiguration();
      if (computerUse.available) {
        try { await deps.testComputerUseCapability(); }
        catch (error) {
          const key = deps.resolveModelSettings().apiKey;
          computerUse = { ...computerUse, available: false, reason: (error instanceof Error ? error.message : '截图输入与工具调用预检失败。').replaceAll(key || '\u0000', '[已隐藏]') };
        }
      }
      json(res, 200, { ...(result as object), computerUse });
    } catch (error) {
      const key = deps.resolveModelSettings().apiKey;
      const reason = (error instanceof Error ? error.message : '连接失败。').replaceAll(key || '\u0000', '[已隐藏]');
      fail(res, 502, reason);
    }
    return true;
  }
  if (req.method === 'POST' && pathname === '/api/settings/test-browser') {
    try { json(res, 200, await deps.testBrowserCdpConnection()); }
    catch (error) { fail(res, 502, error instanceof Error ? error.message : 'Edge CDP 连接失败。'); }
    return true;
  }
  if (req.method === 'GET' && pathname === '/api/browser/status') {
    json(res, 200, await deps.getBrowserRuntimeStatus());
    return true;
  }
  return false;
}
