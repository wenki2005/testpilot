import type { IncomingMessage, ServerResponse } from "node:http";
import type { DemoCheck } from "./contracts.js";

export const defaultRequirements = `订单 API 业务规则：商品 sku-1（经典咖啡）单价 120 元，sku-2（旅行杯）单价 80 元；订单小计为商品单价乘数量之和。discountPercent 默认 0，必须是 0 到 100 之间的有限数，折后总额按分四舍五入。数量必须是正整数。无登录凭证访问订单导出必须返回 401；有效凭证为 Authorization: Bearer demo-export-token。健康检查应返回 ok=true。`;

export const availableRoutes = [
  "GET /sample/openapi.json — 样例 API 合同",
  "GET /sample/health — 健康检查",
  "GET /sample/products — 商品目录",
  "POST /sample/orders — 创建订单并计算金额",
  "GET /sample/orders/export — 导出订单（需要登录）",
];

const products = [
  { id: "sku-1", name: "经典咖啡", price: 120 },
  { id: "sku-2", name: "旅行杯", price: 80 },
];

export const defaultChecks: DemoCheck[] = [
  {
    id: "sample-health",
    title: "健康检查可用",
    source: "fixed",
    method: "GET",
    path: "/sample/health",
    expect: { status: 200, json: { ok: true } },
  },
  {
    id: "sample-products",
    title: "商品目录包含已知商品",
    source: "fixed",
    method: "GET",
    path: "/sample/products",
    expect: { status: 200, json: { products } },
  },
  {
    id: "sample-order-total",
    title: "两件咖啡按单价计算订单总额",
    source: "fixed",
    method: "POST",
    path: "/sample/orders",
    headers: { "content-type": "application/json" },
    body: { items: [{ productId: "sku-1", quantity: 2 }] },
    expect: { status: 201, json: { subtotal: 240, discount: 0, total: 240 } },
  },
  {
    id: "sample-negative-quantity",
    title: "拒绝负数商品数量",
    source: "fixed",
    method: "POST",
    path: "/sample/orders",
    headers: { "content-type": "application/json" },
    body: { items: [{ productId: "sku-1", quantity: -1 }] },
    expect: { status: 400 },
  },
];

const openApi = {
  openapi: "3.1.0",
  info: { title: "TestPilot 示例订单 API", version: "1.0.0", description: defaultRequirements },
  paths: {
    "/sample/health": { get: { summary: "健康检查", responses: { "200": { description: "服务健康，返回 ok=true" } } } },
    "/sample/products": { get: { summary: "商品目录", responses: { "200": { description: "返回 sku-1 与 sku-2，价格单位为元" } } } },
    "/sample/orders": {
      post: {
        summary: "创建订单",
        description: "数量必须为正整数；discountPercent 可省略，或为 0 到 100 的有限数。",
        responses: {
          "201": { description: "返回 subtotal、discount 与 total，均以元表示" },
          "400": { description: "数量或折扣无效" },
        },
      },
    },
    "/sample/orders/export": {
      get: {
        summary: "导出订单",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "已认证" }, "401": { description: "缺少或无效的 Bearer 凭证" } },
      },
    },
  },
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.byteLength;
    if (size > 64 * 1024) throw new Error("Request body too large");
    chunks.push(part);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Request body must be valid JSON"); }
}

export async function handleSample(req: IncomingMessage, res: ServerResponse, fixed: boolean): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  if (path !== "/sample" && path !== "/sample/" && !path.startsWith("/sample/")) return false;
  if (req.method === "GET" && path === "/sample/openapi.json") { send(res, 200, openApi); return true; }
  if (req.method === "GET" && path === "/sample/health") { send(res, 200, { ok: true }); return true; }
  if (req.method === "GET" && path === "/sample/products") { send(res, 200, { products }); return true; }
  if (req.method === "GET" && path === "/sample/orders/export") {
    const auth = req.headers.authorization;
    if (auth !== "Bearer demo-export-token" && fixed) send(res, 401, { error: "unauthorized" });
    else send(res, 200, { exported: true, orders: [] });
    return true;
  }
  if (req.method === "POST" && path === "/sample/orders") {
    let input: any;
    try { input = await readJson(req); }
    catch (error) { send(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON" }); return true; }
    if (!input || typeof input !== "object" || Array.isArray(input) || !Array.isArray(input.items) || input.items.length === 0) {
      send(res, 400, { error: "items must be a non-empty array" }); return true;
    }
    const discountPercent = input.discountPercent ?? 0;
    if (fixed && (typeof discountPercent !== "number" || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100)) {
      send(res, 400, { error: "discountPercent must be between 0 and 100" }); return true;
    }
    let subtotal = 0;
    for (const item of input.items) {
      const product = products.find(p => p.id === item?.productId);
      if (!product || !Number.isInteger(item?.quantity) || (fixed && item.quantity <= 0)) {
        send(res, 400, { error: "items must reference a product and have a valid positive integer quantity" }); return true;
      }
      subtotal += product.price * item.quantity;
    }
    const discount = Math.round(subtotal * discountPercent) / 100;
    const total = Math.round((subtotal - discount) * 100) / 100;
    send(res, 201, { id: "ord-demo-001", items: input.items, subtotal, discount, total, discountPercent });
    return true;
  }
  if (path === "/sample" || path === "/sample/") {
    if (req.method !== "GET") { send(res, 405, { error: "method_not_allowed" }); return true; }
    const html = `<!doctype html><meta charset="utf-8"><title>TestPilot 示例订单</title><main style="font:16px system-ui;max-width:680px;margin:48px auto;color:#172a45"><h1>示例订单 API</h1><p>订单 API 可验证商品、数量、折扣、金额和导出权限。</p><p><a href="/sample/openapi.json">查看 OpenAPI 合同</a></p><button id="create">创建两件咖啡订单</button><pre id="out"></pre></main><script>document.querySelector('#create').onclick=async()=>{let r=await fetch('/sample/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{productId:'sku-1',quantity:2}]})});document.querySelector('#out').textContent=JSON.stringify(await r.json(),null,2)}</script>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) }); res.end(html); return true;
  }
  send(res, 404, { error: "sample_route_not_found" });
  return true;
}
