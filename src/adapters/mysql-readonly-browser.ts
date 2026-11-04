import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseEvidenceRow } from '../domain/document-database-evidence.js';

const DATABASE_HOST = "47.95.211.86";
const DATABASE_PORT = 12010;
const DATABASE_NAME = "supply";
const MAX_PAGE_SIZE = 50;
const MAX_OFFSET = 50_000;

export interface MysqlTable { name: string }
export interface MysqlColumn {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  sensitive: boolean;
  displayable: boolean;
}
export interface MysqlRowsPage {
  table: string;
  columns: MysqlColumn[];
  rows: Array<Record<string, string | number | null>>;
  offset: number;
  limit: number;
  hasMore: boolean;
}

let pool: Pool | undefined;
let connectedAccount: string | undefined;
export type MysqlTlsMode = "verify-certificate" | "encrypted-unverified";
let connectedTlsMode: MysqlTlsMode | undefined;

export function mysqlBrowserConfig(): { host: string; port: number; database: string } {
  return { host: DATABASE_HOST, port: DATABASE_PORT, database: DATABASE_NAME };
}

export function mysqlBrowserStatus(): { connected: boolean; host: string; port: number; database: string; account?: string; tlsMode?: MysqlTlsMode; encrypted: boolean; certificateVerified: boolean } {
  return { ...mysqlBrowserConfig(), connected: !!pool, encrypted: !!pool, certificateVerified: !!pool && connectedTlsMode === "verify-certificate", ...(connectedAccount ? { account: connectedAccount } : {}), ...(connectedTlsMode ? { tlsMode: connectedTlsMode } : {}) };
}

export async function connectMysqlBrowser(input: { user: unknown; password: unknown; tlsMode?: unknown }): Promise<ReturnType<typeof mysqlBrowserStatus>> {
  if (typeof input.user !== "string" || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(input.user)) throw new Error("MySQL 用户名格式无效。");
  if (typeof input.password !== "string" || input.password.length < 1 || input.password.length > 512 || input.password.includes("\u0000")) throw new Error("MySQL 密码无效。");
  const tlsMode = input.tlsMode ?? "verify-certificate";
  if (tlsMode !== "verify-certificate" && tlsMode !== "encrypted-unverified") throw new Error("MySQL TLS 模式无效；仅支持证书校验或加密兼容模式。");

  let ca: Buffer | undefined;
  if (tlsMode === "verify-certificate" && process.env.TESTPILOT_MYSQL_CA_FILE) {
    try { ca = await readFile(path.resolve(process.env.TESTPILOT_MYSQL_CA_FILE)); }
    catch { throw new Error("指定的 MySQL CA 证书文件无法读取。"); }
  }

  const candidate = createPool({
    host: DATABASE_HOST,
    port: DATABASE_PORT,
    user: input.user,
    password: input.password,
    database: DATABASE_NAME,
    connectionLimit: 2,
    waitForConnections: true,
    queueLimit: 4,
    connectTimeout: 8_000,
    enableKeepAlive: true,
    multipleStatements: false,
    // Explicit compatibility mode applies only to this fixed test database pool.
    // TLS remains required; never retry a strict connection with weaker settings.
    ssl: { ...(ca ? { ca } : {}), rejectUnauthorized: tlsMode === "verify-certificate" },
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: "Z",
  });
  try {
    const connection = await candidate.getConnection();
    let grants: string[];
    let account: string;
    try {
      const [tlsRows] = await connection.query<RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
      if (!tlsRows[0]?.Value) throw new Error("MySQL TLS 加密未建立；拒绝连接。");
      const [grantRows] = await connection.query<RowDataPacket[]>("SHOW GRANTS FOR CURRENT_USER()");
      grants = grantRows.map(row => String(Object.values(row)[0] ?? ""));
      const [identityRows] = await connection.query<RowDataPacket[]>("SELECT CURRENT_USER() AS account, DATABASE() AS databaseName");
      account = String(identityRows[0]?.account ?? "");
      if (identityRows[0]?.databaseName !== DATABASE_NAME) throw new Error("连接的数据库与配置不一致。");
    } finally {
      connection.release();
    }
    assertSelectOnlySchemaGrant(grants);
    const previous = pool;
    pool = candidate;
    connectedAccount = account;
    connectedTlsMode = tlsMode;
    if (previous) void previous.end().catch(() => undefined);
    return mysqlBrowserStatus();
  } catch (error) {
    await candidate.end().catch(() => undefined);
    if (error instanceof Error && error.message.includes("只读")) throw error;
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    if (code === "HANDSHAKE_NO_SSL_SUPPORT") throw new Error("MySQL 服务端未启用 TLS；为保护数据库密码，TestPilot 拒绝明文连接。请联系数据库管理员开启 TLS 后重试。");
    if (code === "HANDSHAKE_SSL_ERROR" || /^(?:DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_ALTNAME_INVALID)$/u.test(code)) throw new Error("MySQL TLS 证书无法验证；未建立连接。请向数据库管理员取得 CA PEM，并在启动 TestPilot 前设置 TESTPILOT_MYSQL_CA_FILE 指向该文件。");
    if (code === "ER_ACCESS_DENIED_ERROR") throw new Error("MySQL 登录失败，请检查用户名和密码。");
    if (["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH"].includes(code)) throw new Error("无法连接测试库网络地址，请检查网络和端口开放状态。");
    throw new Error("无法连接测试库，或数据库账号未配置为 supply 库只读账号。请检查用户名、密码和网络。");
  }
}

export async function disconnectMysqlBrowser(): Promise<void> {
  const current = pool;
  pool = undefined;
  connectedAccount = undefined;
  connectedTlsMode = undefined;
  if (current) await current.end();
}

/** Fixed, bounded SELECT projections for regression; no SQL or table name comes from a model. */
export async function readDepartmentDatabaseSummary() {
  return withReadOnlyConnection(requirePool(),async connection=>{
    const [applications]=await connection.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS count FROM biz_dept_book_apply WHERE del_flag='0'");
    const [goods]=await connection.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS count, COUNT(DISTINCT apply_id) AS applications FROM biz_dept_book_apply_goods WHERE del_flag='0'");
    const [orphans]=await connection.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS count FROM biz_dept_book_apply_goods g LEFT JOIN biz_dept_book_apply a ON a.id=g.apply_id AND a.del_flag='0' WHERE g.del_flag='0' AND a.id IS NULL");
    return {applications:Number(applications[0]!.count),goods:Number(goods[0]!.count),applicationsWithGoods:Number(goods[0]!.applications),orphanGoods:Number(orphans[0]!.count)};
  });
}

/** Fixed SELECT projections for the two named OA templates and aggregate
 * application references. No names, recipients or approval numbers leave DB. */
export async function readDepartmentOaTemplateConfiguration():Promise<import('./dify-oa-template-configuration.js').OaTemplateConfigurationSnapshot>{
 return withReadOnlyConnection(requirePool(),async connection=>{
  const [templates]=await connection.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ template_name,template_id,del_flag FROM biz_wechat_oa_template WHERE template_name IN ('部门样书申请-营销用书','部门样书申请-产品用书') OR template_id IN ('C4enk3QyyZi7NYJXM8ShAUZ6jwTKUMdPzEWAUceGH','C4enk3UYnvWjJmLGxb4PHgGhX5h4hqgju2yoEu89z') LIMIT 21");
  const [applications]=await connection.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ book_usage,template_id,COUNT(*) AS count FROM biz_dept_book_apply WHERE del_flag='0' GROUP BY book_usage,template_id LIMIT 101");
  if(templates.length>20||applications.length>100)throw Error('OA配置核验超出有界查询范围。');
  return{templates:templates.map(t=>({name:String(t.template_name??''),templateId:String(t.template_id??''),deleted:String(t.del_flag)!=='0'})),applications:applications.map(a=>({usage:Number(a.book_usage),templateId:a.template_id==null?null:String(a.template_id),count:Number(a.count)}))};
 });
}

/** Identifiers originate only from the current authenticated myList response and stay in memory. */
export async function readDepartmentApplications(applyNos:string[]) {
  if(!applyNos.length||applyNos.length>20||new Set(applyNos).size!==applyNos.length||applyNos.some(v=>typeof v!=='string'||v.length>100||!/^[A-Za-z0-9_-]+$/.test(v)))throw Error('当前账号申请记录范围无效。');
  return withReadOnlyConnection(requirePool(),async connection=>{
    const [rows]=await connection.execute<RowDataPacket[]>(`SELECT /*+ MAX_EXECUTION_TIME(5000) */ id,apply_no,examine_status,lock_status,apply_type,book_usage,total_amount,total_weight FROM biz_dept_book_apply WHERE del_flag='0' AND apply_no IN (${applyNos.map(()=>'?').join(',')}) LIMIT 21`,applyNos);
    return rows;
  });
}

/** Diagnose existing fixtures by current authenticated identity; never return
 * raw keys, names, addresses, remarks, configuration values or event payloads. */
export async function readDepartmentBlockerInventory(userId:string):Promise<import('../domain/regression-database-contract.js').DepartmentBlockerInventory>{
 if(!/^\d{1,20}$/.test(userId))throw Error('身份范围无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [states]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ (a.applicant_user_id=?) AS own,a.examine_status AS status,a.lock_status,a.book_usage,COUNT(*) AS count,SUM((SELECT COUNT(*) FROM biz_dept_book_apply_goods g WHERE g.apply_id=a.id AND g.del_flag='0')>1) AS multi_line,SUM(a.order_id IS NOT NULL AND a.order_id<>'') AS order_refs FROM biz_dept_book_apply a WHERE a.del_flag='0' GROUP BY own,a.examine_status,a.lock_status,a.book_usage",[userId]);
  const [links]=await c.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS applications,SUM(a.order_id IS NOT NULL AND a.order_id<>'') AS order_refs,SUM(EXISTS(SELECT 1 FROM biz_order o WHERE o.del_flag=0 AND a.order_id IS NOT NULL AND a.order_id<>'' AND (BINARY o.order_id=BINARY a.order_id OR BINARY o.out_order_id=BINARY a.order_id OR BINARY CAST(o.id AS CHAR)=BINARY a.order_id))) AS matched_orders,SUM(EXISTS(SELECT 1 FROM biz_wechat_oa_template t WHERE t.del_flag='0' AND BINARY t.template_id=BINARY a.template_id)) AS matching_templates,SUM(EXISTS(SELECT 1 FROM biz_third_party_failure_log l WHERE BINARY l.business_ref=BINARY a.apply_no OR BINARY l.business_ref=BINARY a.sp_id OR (a.order_id<>'' AND BINARY l.business_ref=BINARY a.order_id))) AS linked_failures,SUM(EXISTS(SELECT 1 FROM biz_sync_outbox o WHERE BINARY o.aggregate_key=BINARY a.apply_no OR (a.order_id<>'' AND BINARY o.aggregate_key=BINARY a.order_id))) AS linked_outbox,SUM(EXISTS(SELECT 1 FROM biz_order_logistics l WHERE a.order_id<>'' AND BINARY l.order_id=BINARY a.order_id)) AS linked_logistics,SUM(a.lock_fail_notified=1) AS lock_notice,SUM(a.auto_restock_notified=1) AS restock_notice FROM biz_dept_book_apply a WHERE a.del_flag='0'");
  const [configuration]=await c.query<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS count FROM sys_config WHERE config_key LIKE '%dept%' OR config_key LIKE '%warehouse%' OR config_key LIKE '%wdt%' OR config_key LIKE '%template%' OR config_key LIKE '%shop%'");
  const n=(v:unknown)=>Number(v??0),r=links[0]!;
  return{states:states.map(v=>({own:Number(v.own)===1,status:n(v.status),lockStatus:n(v.lock_status),usage:n(v.book_usage),count:n(v.count),multiLine:n(v.multi_line),orderReferences:n(v.order_refs)})),links:{applications:n(r.applications),orderReferences:n(r.order_refs),matchedOrders:n(r.matched_orders),matchingTemplates:n(r.matching_templates),linkedFailures:n(r.linked_failures),linkedOutbox:n(r.linked_outbox),linkedLogistics:n(r.linked_logistics)},notificationFlags:{lockFailure:n(r.lock_notice),restock:n(r.restock_notice)},configurationKeys:n(configuration[0]?.count)};
 });
}

export async function readDepartmentAccountCount(userId:string) {
  if(!/^\d{1,20}$/.test(userId))throw Error('当前账号身份字段不符合约定。');
  return withReadOnlyConnection(requirePool(),async connection=>{
    const [rows]=await connection.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS count FROM biz_dept_book_apply WHERE del_flag='0' AND applicant_user_id=?",[userId]);
    return Number(rows[0]!.count);
  });
}

/** Raw snapshot stays in memory and is scoped to a current-account list key. */
export async function readDepartmentApplicationSnapshot(applyNo:string,userId:string):Promise<Record<string,unknown>|undefined>{
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(applyNo)||!/^\d{1,20}$/.test(userId))throw Error('申请或身份范围无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [rows]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ apply_no,applicant_user_id,applicant_name,dept_name,apply_type,book_usage,cost_client_id,cost_client_name,remark,receiver_name,receiver_phone,province,city,county,detail_address,sp_id,template_id,order_id,examine_status,lock_status,reject_reason FROM biz_dept_book_apply WHERE del_flag='0' AND apply_no=? AND applicant_user_id=? LIMIT 2",[applyNo,userId]);
  if(rows.length!==1)return undefined;
  const [labels]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ dict_label FROM sys_dict_data WHERE dict_type='dept_apply_use' AND dict_value=? AND status='0' LIMIT 2",[String(rows[0]!.book_usage)]);
  return {...rows[0],book_usage_label:labels.length===1?labels[0]!.dict_label:undefined};
 });
}
/** Reconcile a marked submission after success or a lost response. SELECT only;
 * no blind replay and no raw personal identifiers in the returned journal. */
export async function readMarkedDepartmentApplication(userId:string,recipient:string){
 if(!/^\d{1,20}$/.test(userId)||!/^TP[a-f0-9]{8}\d勿发货$/.test(recipient))throw Error('测试写入核对范围无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [rows]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ apply_no,applicant_user_id,apply_type,book_usage,cost_client_id,cost_client_name,remark,receiver_name,receiver_phone,province,city,county,detail_address,examine_status,lock_status,sp_id,template_id,total_amount,total_weight FROM biz_dept_book_apply WHERE del_flag='0' AND applicant_user_id=? AND receiver_name=? LIMIT 3",[userId,recipient]);
  return rows;
 });
}
/** One existing non-owner test record; only its key leaves the readonly query. */
export async function readNonOwnerDepartmentApplication(userId:string){
 if(!/^\d{1,20}$/.test(userId))throw Error('身份范围无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [rows]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ apply_no FROM biz_dept_book_apply WHERE del_flag='0' AND applicant_user_id<>? AND apply_no IS NOT NULL ORDER BY id LIMIT 1",[userId]);
  const value=rows[0]?.apply_no;return typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
 });
}
/** Aggregate backend evidence, without exporting remarks or approval numbers. */
export async function readDepartmentRemarkEvidence(usage:1|2){
 if(usage!==1&&usage!==2)throw Error('用途无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [rows]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS applications,SUM(a.sp_id IS NOT NULL AND a.sp_id<>'') AS approvals,SUM(a.order_id IS NOT NULL AND a.order_id<>'') AS order_references,SUM(o.id IS NOT NULL) AS matched_orders FROM biz_dept_book_apply a LEFT JOIN biz_order o ON BINARY o.order_id=BINARY a.order_id AND o.del_flag='0' WHERE a.del_flag='0' AND a.book_usage=?",[usage]);
  const r=rows[0]!;return{applications:Number(r.applications),approvals:Number(r.approvals??0),orderReferences:Number(r.order_references??0),matchedOrders:Number(r.matched_orders??0)};
 });
}

/** Explicit client classification projection. No customer names are persisted. */
export async function readDepartmentCustomerCategories(codes:string[]){
 if(!codes.length||codes.length>100||new Set(codes).size!==codes.length||codes.some(c=>!/^[A-Za-z0-9_-]{1,60}$/.test(c)))throw Error('客户分类核对范围无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [rows]=await c.execute<RowDataPacket[]>(`SELECT /*+ MAX_EXECUTION_TIME(5000) */ agent_id,agent_type FROM biz_agent_info WHERE del_flag=0 AND agent_id IN (${codes.map(()=>'?').join(',')}) LIMIT 101`,codes);
  return rows.map(r=>({code:String(r.agent_id),category:String(r.agent_type)}));
 });
}
export async function readDepartmentAllowedCustomers(){
 return withReadOnlyConnection(requirePool(),async c=>{
  const out:Array<{code:string;category:string}>=[];
  for(const category of ['1004.00','1004.06']){const [rows]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ agent_id,agent_type FROM biz_agent_info WHERE del_flag=0 AND agent_type=? ORDER BY is_valid DESC,is_grade_reviewed DESC,id LIMIT 1",[category]);if(rows.length===1)out.push({code:String(rows[0]!.agent_id),category:String(rows[0]!.agent_type)});}
  return out;
 });
}
/** Locate actual configuration evidence without equating carrier warehouses
 * or Douyin shops with this business's WDT deployment mappings. */
export async function readDepartmentConfigurationInventory(){
 return withReadOnlyConnection(requirePool(),async c=>{
  const [keys]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ config_key FROM sys_config WHERE LOWER(config_key) REGEXP 'dept|warehouse|wdt|shop' LIMIT 101");
  const [warehouses]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ name,sid,type,status FROM biz_carrier_warehouse WHERE del_flag='0' AND name REGEXP '长沙|天津' LIMIT 101");
  const [shopColumns]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME REGEXP 'dept_book|wdt|shop' AND COLUMN_NAME REGEXP 'shop|store') LIMIT 101");
  return{keys:keys.map(r=>String(r.config_key)),warehouses:warehouses.map(r=>({name:String(r.name),sid:String(r.sid),type:String(r.type),status:String(r.status)})),shopColumns:shopColumns.map(r=>({table:String(r.TABLE_NAME),column:String(r.COLUMN_NAME)}))};
 });
}
export async function readDepartmentNotificationInventory(userId:string){
 if(!/^\d{1,20}$/.test(userId))throw Error('通知核对身份无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [apps]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(*) AS count,SUM(sp_id IS NOT NULL AND sp_id<>'') AS approvals,SUM(approver_userid IS NOT NULL AND approver_userid<>'') AS recipients,SUM(lock_status=2) AS lock_failures,SUM(examine_status=3) AS cancelled FROM biz_dept_book_apply WHERE del_flag='0' AND applicant_user_id=?",[userId]);
  const [events]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ DISTINCT o.event_id,o.destination,o.event_type,o.status,o.payload,o.published_at,o.last_error FROM biz_sync_outbox o JOIN biz_dept_book_apply a ON (BINARY o.aggregate_key=BINARY a.apply_no OR (a.sp_id<>'' AND BINARY o.aggregate_key=BINARY a.sp_id) OR (a.order_id<>'' AND BINARY o.aggregate_key=BINARY a.order_id)) WHERE a.del_flag='0' AND a.applicant_user_id=? LIMIT 101",[userId]);
  if(events.length>100)throw Error('Blocked: 关联外发事件超过核验上限，未截断后计通过。');
  const [failures]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ COUNT(DISTINCT f.id) AS n FROM biz_third_party_failure_log f JOIN biz_dept_book_apply a ON (BINARY f.business_ref=BINARY a.apply_no OR (a.sp_id<>'' AND BINARY f.business_ref=BINARY a.sp_id) OR (a.order_id<>'' AND BINARY f.business_ref=BINARY a.order_id)) WHERE a.del_flag='0' AND a.applicant_user_id=?",[userId]);
  const row=apps[0]!;return{applications:Number(row.count),approvals:Number(row.approvals??0),recipients:Number(row.recipients??0),lockFailures:Number(row.lock_failures??0),cancelled:Number(row.cancelled??0),linkedFailures:Number(failures[0]?.n??0),events:events.map(e=>{let payload:unknown=e.payload;try{if(typeof payload==='string')payload=JSON.parse(payload);}catch{payload=undefined;}return{destination:String(e.destination),type:String(e.event_type),status:String(e.status),published:!!e.published_at,errorPresent:!!e.last_error,payloadKeys:payload&&typeof payload==='object'?Object.keys(payload):[]};})};
 });
}

/** One active counterexample per excluded category, paired with an allowed
 * category having identical validity/review flags. The real API must return
 * the positive control before a negative result is accepted. */
export async function readDepartmentExcludedCustomers(){
 const current=requirePool();return withReadOnlyConnection(current,async connection=>{
  const found:Array<{code:string;category:string;control?:{code:string;category:string}}>=[];
  for(const category of ['1004.01','1004.02','1004.03','1004.04','1004.05']){
   const [rows]=await connection.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ agent_id,agent_type,is_valid,is_grade_reviewed FROM biz_agent_info WHERE del_flag=0 AND agent_type=? ORDER BY is_valid DESC,is_grade_reviewed DESC,id LIMIT 1",[category]);
   if(rows.length!==1||typeof rows[0]!.agent_id!=='string'||rows[0]!.agent_type!==category)continue;
   const candidate=rows[0]!;
   const [controls]=await connection.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ agent_id,agent_type FROM biz_agent_info WHERE del_flag=0 AND agent_type='1004.00' AND is_valid=? AND is_grade_reviewed=? ORDER BY id LIMIT 1",[candidate.is_valid,candidate.is_grade_reviewed]);
   found.push({code:candidate.agent_id,category,...(controls.length===1&&typeof controls[0]!.agent_id==='string'?{control:{code:controls[0]!.agent_id,category:String(controls[0]!.agent_type)}}:{})});
  }
  return found;
 });
}

export async function readDepartmentGoods(applyNo:string) {
  if(typeof applyNo!=='string'||applyNo.length>100||!/^[A-Za-z0-9_-]+$/.test(applyNo))throw Error('当前账号申请记录范围无效。');
  return withReadOnlyConnection(requirePool(),async connection=>{
    const [rows]=await connection.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(5000) */ g.product_id,g.qty,g.price,g.subtotal,g.unit_weight FROM biz_dept_book_apply_goods g JOIN biz_dept_book_apply a ON a.id=g.apply_id WHERE a.del_flag='0' AND g.del_flag='0' AND a.apply_no=? LIMIT 101",[applyNo]);
    if(rows.length>100)throw Error('明细超过本轮只读核验上限。');
    return rows;
  });
}

/** Fixed SELECT contracts for the already-established department test records.
 * Neither model nor HTTP callers can supply SQL, table names or credentials. */
export async function readDepartmentAgentDatabaseRows(): Promise<Array<{ key: string; rows: DatabaseEvidenceRow[] }>> {
  return withReadOnlyConnection(requirePool(), async connection => {
    await connection.query('SET SESSION MAX_EXECUTION_TIME=5000');
    const queries = [
      { key: 'applications', sql: 'SELECT apply_no,apply_type,book_usage,total_amount,total_weight,examine_status,lock_status,order_id,del_flag,create_time FROM biz_dept_book_apply WHERE apply_no IN (?,?) ORDER BY apply_no LIMIT 2', values: ['202611020158','202611030001'] },
      { key: 'goods', sql: 'SELECT a.apply_no,g.product_id,g.qty,g.price,g.subtotal,g.unit_weight,g.total_weight,g.del_flag FROM biz_dept_book_apply_goods g JOIN biz_dept_book_apply a ON a.id=g.apply_id WHERE a.apply_no IN (?,?) AND g.del_flag=\'0\' ORDER BY a.apply_no,g.id LIMIT 20', values: ['202611020158','202611030001'] },
      { key: 'customers', sql: 'SELECT agent_id,agent_type,is_valid,is_b2b,del_flag FROM biz_agent_info WHERE agent_id=? LIMIT 1', values: ['129249'] },
      { key: 'books', sql: 'SELECT product_id,book_name,pubname,hprice,weight,stock_amount,is_valid FROM biz_book_info WHERE product_id IN (?,?) ORDER BY product_id LIMIT 4', values: ['2022600046','2022600047'] },
    ];
    const result: Array<{ key: string; rows: DatabaseEvidenceRow[] }> = [];
    for (const query of queries) {
      const [rows] = await connection.execute<RowDataPacket[]>(query.sql, query.values);
      result.push({ key: query.key, rows: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toDisplayValue(value)]))) });
    }
    return result;
  });
}

export async function listMysqlTables(): Promise<MysqlTable[]> {
  const current = requirePool();
  return withReadOnlyConnection(current, async connection => {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      [DATABASE_NAME],
    );
    return rows.map(row => ({ name: String(row.tableName) }));
  });
}

export async function listMysqlColumns(tableName: string): Promise<MysqlColumn[]> {
  const current = requirePool();
  return withReadOnlyConnection(current, async connection => {
    await assertTableExists(connection, tableName);
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_KEY AS columnKey, EXTRA AS extra FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
      [DATABASE_NAME, tableName],
    );
    return rows.map(row => {
      const name = String(row.columnName);
      const dataType = String(row.dataType).toLowerCase();
      return {
        name,
        dataType,
        columnType: String(row.columnType),
        nullable: row.isNullable === "YES",
        primaryKey: row.columnKey === "PRI",
        autoIncrement: String(row.extra).toLowerCase().includes("auto_increment"),
        sensitive: isSensitiveColumn(name),
        displayable: !isBinaryOrStructuredType(dataType),
      };
    });
  });
}

export async function readMysqlRows(tableName: string, offsetValue: number, limitValue: number): Promise<MysqlRowsPage> {
  if (!Number.isSafeInteger(offsetValue) || offsetValue < 0 || offsetValue > MAX_OFFSET) throw new Error(`offset 必须在 0–${MAX_OFFSET} 之间。`);
  if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > MAX_PAGE_SIZE) throw new Error(`limit 必须在 1–${MAX_PAGE_SIZE} 之间。`);
  const current = requirePool();
  return withReadOnlyConnection(current, async connection => {
    const columns = await listColumnsOnConnection(connection, tableName);
    if (!columns.length) throw new Error("找不到该数据表。");
    const projection = columns.map(column => {
      const escapedName = `\`${column.name.replaceAll("`", "``")}\``;
      if (column.sensitive || !column.displayable) return `NULL AS ${escapedName}`;
      if (["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"].includes(column.dataType)) return `LEFT(${escapedName}, 500) AS ${escapedName}`;
      return escapedName;
    }).join(", ");
    const escapedTable = `\`${tableName.replaceAll("`", "``")}\``;
    const [sourceRows] = await connection.execute<RowDataPacket[]>(
      `SELECT ${projection} FROM ${escapedTable} LIMIT ? OFFSET ?`,
      [limitValue + 1, offsetValue],
    );
    const hasMore = sourceRows.length > limitValue;
    const rows = sourceRows.slice(0, limitValue).map(source => {
      const output: Record<string, string | number | null> = {};
      for (const column of columns) {
        if (column.sensitive) { output[column.name] = "（敏感字段已遮蔽）"; continue; }
        if (!column.displayable) { output[column.name] = "（二进制或结构化字段不展示）"; continue; }
        output[column.name] = toDisplayValue(source[column.name]);
      }
      return output;
    });
    return { table: tableName, columns, rows, offset: offsetValue, limit: limitValue, hasMore };
  });
}

export function isSensitiveColumn(name: string): boolean {
  return /(?:pass(?:word)?|secret|token|cookie|authorization|api.?key|name|phone|mobile|tel(?:ephone)?|email|mail|address|addr|identity|id.?card|person|applicant|receiver|contact|operator|approver|owner|manager|leader|user|account|wechat|open.?id|avatar|photo|picture|image|remark|comment|content|description|reason|location|province|city|county|district|region|longitude|latitude|coordinate|signature|url|apply.?no|order.?id|client.?id|sp.?id|create_by|update_by)/iu.test(name);
}

function isBinaryOrStructuredType(dataType: string): boolean {
  return /^(?:binary|varbinary|tinyblob|blob|mediumblob|longblob|json|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/u.test(dataType);
}

function toDisplayValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return "（该数据类型暂不展示）";
}

async function assertTableExists(connection: PoolConnection, tableName: string): Promise<void> {
  if (typeof tableName !== "string" || tableName.length < 1 || tableName.length > 64) throw new Error("数据表名称无效。");
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT TABLE_NAME AS tableName FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'",
    [DATABASE_NAME, tableName],
  );
  if (rows.length !== 1) throw new Error("找不到该数据表。");
}

async function listColumnsOnConnection(connection: PoolConnection, tableName: string): Promise<MysqlColumn[]> {
  await assertTableExists(connection, tableName);
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_KEY AS columnKey, EXTRA AS extra FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    [DATABASE_NAME, tableName],
  );
  return rows.map(row => {
    const name = String(row.columnName);
    const dataType = String(row.dataType).toLowerCase();
    return {
      name,
      dataType,
      columnType: String(row.columnType),
      nullable: row.isNullable === "YES",
      primaryKey: row.columnKey === "PRI",
      autoIncrement: String(row.extra).toLowerCase().includes("auto_increment"),
      sensitive: isSensitiveColumn(name),
      displayable: !isBinaryOrStructuredType(dataType),
    };
  });
}

function assertSelectOnlySchemaGrant(grants: string[]): void {
  const normalized = grants.map(grant => grant.replaceAll("`", "").trim().toUpperCase());
  const valid = normalized.length === 2
    && normalized.some(grant => /^GRANT USAGE ON \*\.\* TO /u.test(grant))
    && normalized.some(grant => /^GRANT SELECT ON SUPPLY\.\* TO /u.test(grant));
  if (!valid) throw new Error("为安全起见，TestPilot 只接受仅对 supply 库有 SELECT 权限的账号。");
}

function requirePool(): Pool {
  if (!pool) throw new Error("尚未连接 MySQL 测试库。");
  return pool;
}

async function withReadOnlyConnection<T>(currentPool: Pool, operation: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await currentPool.getConnection();
  let transactionStarted = false;
  try {
    await connection.query("START TRANSACTION READ ONLY");
    transactionStarted = true;
    return await operation(connection);
  } finally {
    try {
      if (transactionStarted) await connection.query("ROLLBACK");
    } finally {
      connection.release();
    }
  }
}

export async function readDepartmentAdminAccessEvidence(userId:string,applyNos:string[]){
 if(!/^\d{1,20}$/.test(userId)||applyNos.length>2||applyNos.some(v=>!/^[A-Za-z0-9_-]{1,100}$/.test(v)))throw Error('后台核验输入无效。');
 return withReadOnlyConnection(requirePool(),async connection=>{
  const [roles]=await connection.execute<RowDataPacket[]>('SELECT r.role_key FROM sys_user_role ur JOIN sys_role r ON r.role_id=ur.role_id WHERE ur.user_id=? AND r.status=\'0\'',[userId]);
  const [grants]=await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM sys_user_role ur JOIN sys_role_menu rm ON rm.role_id=ur.role_id JOIN sys_menu m ON m.menu_id=rm.menu_id WHERE ur.user_id=? AND m.status='0' AND m.menu_name IN ('内部订单管理','员工福利订单','部门用书订单')",[userId]);
  const [allowed]=await connection.execute<RowDataPacket[]>("SELECT COUNT(DISTINCT r.role_key) AS n FROM sys_role r JOIN sys_role_menu rm ON rm.role_id=r.role_id JOIN sys_menu m ON m.menu_id=rm.menu_id WHERE r.role_key IN ('Manager','bookOrderAdminInner') AND r.status='0' AND m.status='0' AND m.menu_name='内部订单管理'");
  const applications:Array<{applyNo:string;orderId:string;spId:string}>=[];
  for(const key of applyNos){const [rows]=await connection.execute<RowDataPacket[]>('SELECT apply_no,order_id,sp_id FROM biz_dept_book_apply WHERE del_flag=\'0\' AND apply_no=? LIMIT 2',[key]);if(rows.length===1)applications.push({applyNo:String(rows[0]!.apply_no),orderId:String(rows[0]!.order_id),spId:String(rows[0]!.sp_id)});}
  return {roles:roles.map(r=>String(r.role_key)),currentInternalMenus:Number(grants[0]?.n),authorizedRoleMenuGrants:Number(allowed[0]?.n),applications};
 });
}

export async function readDepartmentAdminFilterEvidence(applyNos:string[],customerCodes:string[]){
 if(!applyNos.length||applyNos.length>100||customerCodes.length>100||applyNos.some(v=>!/^[A-Za-z0-9_-]{1,100}$/.test(v))||customerCodes.some(v=>!/^[A-Za-z0-9_-]{1,60}$/.test(v)))throw Error('后台筛选数据库范围无效。');
 return withReadOnlyConnection(requirePool(),async c=>{
  const [apps]=await c.execute<RowDataPacket[]>('SELECT /*+ MAX_EXECUTION_TIME(3000) */ apply_no,order_id,book_usage,cost_client_id,cost_client_name,examine_status,lock_status,sp_id,total_amount FROM biz_dept_book_apply WHERE del_flag=\'0\' AND apply_no IN ('+applyNos.map(()=>'?').join(',')+') ORDER BY apply_no LIMIT 101',applyNos);
  const [customers]=customerCodes.length?await c.execute<RowDataPacket[]>('SELECT /*+ MAX_EXECUTION_TIME(3000) */ agent_id,agent_name,agent_type FROM biz_agent_info WHERE del_flag=\'0\' AND agent_id IN ('+customerCodes.map(()=>'?').join(',')+') ORDER BY agent_id LIMIT 101',customerCodes):[[] as RowDataPacket[]];
  if(apps.length>100||customers.length>100)throw Error('后台筛选独立基线超过上限。');
  const [dictionary]=await c.execute<RowDataPacket[]>("SELECT /*+ MAX_EXECUTION_TIME(2000) */ dict_type,dict_value,dict_label FROM sys_dict_data WHERE status='0' AND (dict_type REGEXP 'dept.*(delivery|ship)|(delivery|ship).*dept' OR dict_label REGEXP '快递仓|物流仓') ORDER BY dict_type,dict_sort LIMIT 101");if(dictionary.length>100)throw Error('发货字典超过核验上限。');
  return{applications:apps.map(a=>({applyNo:String(a.apply_no),orderId:String(a.order_id),usage:Number(a.book_usage),customerId:String(a.cost_client_id),customerName:String(a.cost_client_name),examineStatus:Number(a.examine_status),lockStatus:Number(a.lock_status),approvalId:String(a.sp_id),amount:Number(a.total_amount)})),customers:customers.map(a=>({code:String(a.agent_id),name:String(a.agent_name),category:String(a.agent_type)})),deliveryDictionary:dictionary.map(d=>({type:String(d.dict_type),value:String(d.dict_value),label:String(d.dict_label)}))};
 });
}

