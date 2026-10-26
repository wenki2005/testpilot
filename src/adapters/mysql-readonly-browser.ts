import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

export function mysqlBrowserConfig(): { host: string; port: number; database: string } {
  return { host: DATABASE_HOST, port: DATABASE_PORT, database: DATABASE_NAME };
}

export function mysqlBrowserStatus(): { connected: boolean; host: string; port: number; database: string; account?: string } {
  return { ...mysqlBrowserConfig(), connected: !!pool, ...(connectedAccount ? { account: connectedAccount } : {}) };
}

export async function connectMysqlBrowser(input: { user: unknown; password: unknown }): Promise<ReturnType<typeof mysqlBrowserStatus>> {
  if (typeof input.user !== "string" || !/^[A-Za-z0-9_.@-]{1,64}$/u.test(input.user)) throw new Error("MySQL 用户名格式无效。");
  if (typeof input.password !== "string" || input.password.length < 1 || input.password.length > 512 || input.password.includes("\u0000")) throw new Error("MySQL 密码无效。");

  let ca: Buffer | undefined;
  if (process.env.TESTPILOT_MYSQL_CA_FILE) {
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
    ssl: { ...(ca ? { ca } : {}), rejectUnauthorized: true },
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
  if (current) await current.end();
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
