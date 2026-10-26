import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const records = new Map();
const maxBodyBytes = 16_384;

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(value === undefined ? '' : JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function samplePage(build) {
  const regression = build === 'regression';
  const buildLabel = build === 'fixed' ? 'fixed' : build;
  const heading = regression ? 'Activity Overview' : 'Application Overview';
  const escapedBuild = buildLabel.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TestPilot regression sample</title>
<style>
:root{font:16px/1.5 system-ui,sans-serif;color:#183148;background:#f2f6fa}*{box-sizing:border-box}body{margin:0}.topbar{padding:18px max(20px,calc((100vw - 920px)/2));background:#fff;border-bottom:1px solid #dce5ed}.brand{font-weight:750;letter-spacing:.02em}.shell{max-width:920px;margin:32px auto;padding:0 20px}.hero,.panel{padding:22px;border:1px solid #dce5ed;border-radius:12px;background:#fff;box-shadow:0 8px 28px #17354d0c}.hero{margin-bottom:16px}.eyebrow{color:#54728c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}h1{margin:4px 0 6px;font-size:clamp(24px,4vw,34px)}.build{color:#73869a;font-size:13px}.layout{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel h2{margin:0 0 14px;font-size:17px}label{display:grid;gap:5px;margin-bottom:12px;color:#557087;font-size:13px}input{width:100%;height:40px;padding:0 11px;border:1px solid #cad7e2;border-radius:7px;font:inherit}button{min-height:38px;padding:0 13px;border:0;border-radius:7px;background:#145d78;color:#fff;font:inherit;font-size:13px;font-weight:650;cursor:pointer}button.danger{background:#a6443c}.record-list{display:grid;gap:8px;margin-top:12px}.record{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border:1px solid #e2eaf0;border-radius:7px}.record small{display:block;color:#76889a;overflow-wrap:anywhere}.empty{color:#76889a;font-size:13px}.notice{min-height:20px;color:#a6443c;font-size:13px}@media(max-width:640px){.shell{margin-top:18px}.layout{grid-template-columns:1fr}}
</style></head><body><header class="topbar"><div class="brand">Northstar · Test environment</div></header><main class="shell"><section class="hero"><div class="eyebrow">Regression sample · isolated local data</div><h1>${heading}</h1><div class="build">Deployment: ${escapedBuild}</div></section><div class="layout"><section class="panel"><h2>Application status</h2><p>Health: <strong id="health">checking…</strong></p><p>Record service: ready for synthetic test data</p></section><section class="panel"><h2>Test records</h2><form id="create-form"><label>Record name<input id="record-name" maxlength="80" required value="Synthetic regression record"></label><button type="submit">Create synthetic record</button></form><p id="notice" class="notice" role="status"></p><div id="records" class="record-list"><span class="empty">No records loaded</span></div></section></div></main>
<script>
const recordsNode=document.querySelector('#records'),noticeNode=document.querySelector('#notice');
async function refresh(){const response=await fetch('/api/records?limit=25');const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not load records');recordsNode.replaceChildren();if(!body.items.length){const empty=document.createElement('span');empty.className='empty';empty.textContent='No records';recordsNode.append(empty);return}for(const item of body.items){const row=document.createElement('div');row.className='record';const info=document.createElement('div');const name=document.createElement('strong');name.textContent=item.name;const id=document.createElement('small');id.textContent=item.id;info.append(name,id);const remove=document.createElement('button');remove.className='danger';remove.type='button';remove.textContent='Delete';remove.addEventListener('click',async()=>{const result=await fetch('/api/records/'+encodeURIComponent(item.id),{method:'DELETE'});if(!result.ok){noticeNode.textContent='Could not delete record';return}noticeNode.textContent='Synthetic record cleaned';await refresh()});row.append(info,remove);recordsNode.append(row)}}
document.querySelector('#create-form').addEventListener('submit',async event=>{event.preventDefault();noticeNode.textContent='';const response=await fetch('/api/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),name:document.querySelector('#record-name').value})});const body=await response.json();if(!response.ok){noticeNode.textContent=body.error||'Could not create record';return}noticeNode.textContent='Synthetic record created';await refresh()});
fetch('/health').then(response=>response.json()).then(body=>{document.querySelector('#health').textContent=body.status}).catch(()=>{document.querySelector('#health').textContent='unavailable'});refresh().catch(error=>{noticeNode.textContent=error.message});
</script></body></html>`;
}

export function createWebRegressionSampleServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health' && request.method === 'GET') { sendJson(response, 200, { status: 'ok' }); return; }
    if (url.pathname === '/' && request.method === 'GET') {
      const build = ['baseline', 'regression', 'fixed'].includes(url.searchParams.get('build') ?? '') ? url.searchParams.get('build') : 'baseline';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(samplePage(build));
      return;
    }
    if (url.pathname === '/api/records' && request.method === 'GET') {
      const rawLimit = url.searchParams.get('limit') ?? '25';
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) { sendJson(response, 400, { error: 'limit must be an integer from 1 to 100' }); return; }
      sendJson(response, 200, { items: [...records.values()].slice(0, limit) });
      return;
    }
    if (url.pathname === '/api/records' && request.method === 'POST') {
      let data;
      try { data = await readJson(request); } catch (error) { sendJson(response, error.message === 'request body too large' ? 413 : 400, { error: 'invalid JSON body' }); return; }
      if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(data.id) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80) { sendJson(response, 400, { error: 'id must be a run-scoped UUID and name must contain 1 to 80 characters' }); return; }
      if (records.has(data.id)) { sendJson(response, 409, { error: 'record already exists' }); return; }
      const record = { id: data.id, name: data.name.trim(), state: 'active' };
      records.set(record.id, record);
      sendJson(response, 201, record);
      return;
    }
    const recordMatch = url.pathname.match(/^\/api\/records\/([^/]+)$/u);
    if (recordMatch && request.method === 'GET') {
      const record = records.get(decodeURIComponent(recordMatch[1]));
      if (!record) { sendJson(response, 404, { error: 'record not found' }); return; }
      sendJson(response, 200, record);
      return;
    }
    if (recordMatch && request.method === 'DELETE') {
      const id = decodeURIComponent(recordMatch[1]);
      if (!records.delete(id)) { sendJson(response, 404, { error: 'record not found' }); return; }
      response.writeHead(204, { 'cache-control': 'no-store' }); response.end();
      return;
    }
    sendJson(response, 404, { error: 'route not found' });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requestedPort = Number(process.env.PORT ?? 4328);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) throw new Error('PORT must be an integer from 0 to 65535.');
  const server = createWebRegressionSampleServer();
  server.listen(requestedPort, '127.0.0.1', () => console.log(`TestPilot regression sample listening at http://127.0.0.1:${server.address().port}/`));
  const close = () => server.close(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
