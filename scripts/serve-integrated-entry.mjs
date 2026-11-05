#!/usr/bin/env node
// One local browser entry, two independent backends. No cookies or shared state
// select the owner: the URL (including each tab's Referer) determines routing.
import { createServer, request } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { runtimeRoot, workspacePorts } from './lib/integrated-workspaces.mjs';

const host = '127.0.0.1', port = 4325, origin = `http://${host}:${port}`;
const ownerForPage = url => ['dify-regression', 'module-regression', 'case-scripts', 'run-reports'].includes(url.searchParams.get('page')) ? 'dify' : 'web-regression';
const prefixFor = owner => owner === 'dify' ? '/dify' : '/web';
const pathOwner = url => /^\/dify(?:\/|$)/.test(url.pathname) ? 'dify' : /^\/web(?:\/|$)/.test(url.pathname) ? 'web-regression' : undefined;
const reply = (res, status, message) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(message)); };

const server = createServer((req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return reply(res, 421, { error: 'Invalid local entry host.' });
  const url = new URL(req.url, origin);
  if (url.pathname === '/__entry/health' && req.method === 'GET') return reply(res, 200, { service: 'testpilot-unified-entry', port, backends: workspacePorts });
  const explicitOwner = pathOwner(url);
  const upstreamPath = explicitOwner ? url.pathname.slice(prefixFor(explicitOwner).length) || '/' : url.pathname;
  if (upstreamPath === '/' && req.method === 'GET') {
    const owner = ownerForPage(url), prefix = prefixFor(owner);
    if (url.pathname !== prefix + '/') { res.writeHead(302, { location: `${prefix}/${url.search}`, 'cache-control': 'no-store' }); res.end(); return; }
  }
  let refererOwner;
  if (req.headers.referer) {
    try { const from = new URL(req.headers.referer); if ([origin, `http://localhost:${port}`].includes(from.origin)) refererOwner = pathOwner(from); } catch { /* no trusted page context */ }
  }
  const owner = explicitOwner ?? refererOwner;
  // Unknown API/artifact requests must name their workspace explicitly. Never
  // guess a write destination, or leak data from another tab's last selection.
  if (!owner && !url.pathname.startsWith('/assets/') && url.pathname !== '/favicon.ico') return reply(res, 409, { error: 'Open a workspace page or use /dify/api/... or /web/api/....' });
  if (req.headers.origin && ![origin, `http://localhost:${port}`].includes(req.headers.origin)) return reply(res, 403, { error: 'Cross-origin entry requests are not allowed.' });
  const selected = owner ?? 'web-regression';
  const headers = { ...req.headers, host: `${host}:${workspacePorts[selected]}` };
  // The browser origin was checked above. Present the corresponding local
  // backend origin so its existing same-origin write policy remains intact.
  if (headers.origin) headers.origin = `http://${host}:${workspacePorts[selected]}`;
  delete headers.connection;
  const proxy = request({ hostname: host, port: workspacePorts[selected], method: req.method, path: upstreamPath + url.search, headers }, upstream => {
    const forwarded = { ...upstream.headers, 'referrer-policy': 'same-origin', 'x-testpilot-workspace': selected };
    delete forwarded.connection;
    if (upstreamPath === '/api/config' && upstream.statusCode === 200) {
      const chunks = [];
      upstream.on('data', chunk => chunks.push(chunk));
      upstream.on('end', () => {
        try {
          const config = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          config.workspaces = { ...config.workspaces, difyUrl: origin + '/dify/', webUrl: origin + '/web/' };
          const body = JSON.stringify(config);
          delete forwarded['transfer-encoding'];
          forwarded['content-length'] = Buffer.byteLength(body);
          forwarded['cache-control'] = 'no-store';
          res.writeHead(200, forwarded); res.end(body);
        } catch { if (!res.headersSent) reply(res, 502, { error: 'Invalid workspace configuration.' }); else res.destroy(); }
      });
      return;
    }
    if (typeof forwarded.location === 'string') {
      const redirect = new URL(forwarded.location, `http://${host}:${workspacePorts[selected]}`);
      if (redirect.hostname === host && redirect.port === String(workspacePorts[selected])) forwarded.location = `${prefixFor(selected)}${redirect.pathname}${redirect.search}${redirect.hash}`;
    }
    res.writeHead(upstream.statusCode ?? 502, forwarded);
    upstream.on('error', () => res.destroy());
    upstream.pipe(res);
  });
  proxy.on('error', () => { if (!res.headersSent) reply(res, 502, { error: `${selected} workspace is unavailable. Start the integrated workbench.` }); else res.destroy(); });
  req.on('aborted', () => proxy.destroy());
  res.on('close', () => { if (!res.writableEnded) proxy.destroy(); });
  req.pipe(proxy);
});
server.listen(port, host, () => {
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(path.join(runtimeRoot, 'entry-process.json'), JSON.stringify({ pid: process.pid, port, service: 'testpilot-unified-entry', code: process.argv[1], startedAt: new Date().toISOString() }, null, 2));
  console.log('Unified entry: ' + origin);
});
