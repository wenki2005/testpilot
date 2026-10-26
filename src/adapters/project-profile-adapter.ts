import { createServer, request as httpRequest } from "node:http";
import { cp, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep, join } from "node:path";
import { spawn } from "cross-spawn";
import { once } from "node:events";
import type { ProjectProfile } from "../domain/types.js";

export interface PreparedProfile {
  projectRoot: string;
  env: Record<string, string>;
  close(): Promise<void>;
}

export async function prepareProfile(profile: ProjectProfile): Promise<PreparedProfile> {
  const sourceRoot = resolve(profile.sourceRoot);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error(`Profile sourceRoot is not a directory: ${sourceRoot}`);
  const tempRoot = await mkdtemp(join(tmpdir(), "testpilot-profile-"));
  const projectRoot = join(tempRoot, "project");
  const excluded = new Set((profile.excludePaths ?? []).map((item) => item.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase()));
  await cp(sourceRoot, projectRoot, {
    recursive: true,
    filter: (sourcePath) => {
      const rel = relative(sourceRoot, sourcePath).replaceAll("\\", "/").toLowerCase();
      if (/(^|\/)(?:\.git|node_modules|\.env(?:\..*)?)($|\/)/.test(rel)) return false;
      return ![...excluded].some((item) => rel === item || rel.startsWith(`${item}/`));
    },
  });
  let service: ReturnType<typeof spawn> | undefined;
  let serviceOutput = "";
  const env: Record<string, string> = {};
  try {
    if (profile.service) {
      const port = await freePort();
      for (const [key, value] of Object.entries(profile.service.env ?? {})) env[key] = value.replaceAll("{PORT}", String(port));
      service = spawn(profile.service.bin, profile.service.args, {
        cwd: projectRoot,
        env: safeEnvironment(env),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      service.stdout?.on("data", (chunk: Buffer) => { serviceOutput = cap(serviceOutput, chunk); });
      service.stderr?.on("data", (chunk: Buffer) => { serviceOutput = cap(serviceOutput, chunk); });
      await waitForService(profile.service.healthUrl.replaceAll("{PORT}", String(port)), profile.service.startupTimeoutMs ?? 15_000, service);
      env.PORT = String(port);
      env.DEMO_URL = `http://127.0.0.1:${port}`;
    }
    return {
      projectRoot,
      env,
      async close() {
        if (service) await stopService(service);
        await rm(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (service) await stopService(service);
    await rm(tempRoot, { recursive: true, force: true });
    throw new Error(`${error instanceof Error ? error.message : String(error)}${serviceOutput ? `\nProfile service output:\n${serviceOutput}` : ""}`);
  }
}

export async function preserveProfileArtifacts(profile: ProjectProfile, projectRoot: string, destination: string): Promise<void> {
  for (const configured of profile.preserveArtifacts ?? []) {
    const source = resolve(projectRoot, configured);
    const rel = relative(projectRoot, source);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Artifact path escapes profile copy: ${configured}`);
    try {
      const info = await stat(source);
      const target = join(destination, "target-artifacts", rel);
      await mkdir(dirname(target), { recursive: true });
      if (info.isDirectory()) await cp(source, target, { recursive: true });
      else await cp(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function safeEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "ComSpec", "PATHEXT"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, overrides);
  return env;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolveListen()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate loopback port");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForService(url: string, timeoutMs: number, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "service not ready";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Profile service exited early (${child.exitCode})`);
    try {
      const status = await new Promise<number>((resolveStatus, reject) => {
        const req = httpRequest(url, { method: "GET", timeout: 500 }, (res) => { res.resume(); resolveStatus(res.statusCode ?? 0); });
        req.once("timeout", () => req.destroy(new Error("health check timed out")));
        req.once("error", reject);
        req.end();
      });
      if (status >= 200 && status < 500) return;
      lastError = `health check returned HTTP ${status}`;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    await delay(200);
  }
  throw new Error(`Profile service did not become ready within ${timeoutMs} ms: ${lastError}`);
}

function cap(current: string, chunk: Buffer): string {
  const remaining = 100_000 - Buffer.byteLength(current, "utf8");
  return remaining > 0 ? current + chunk.subarray(0, remaining).toString("utf8") : current;
}
function delay(ms: number): Promise<void> { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
async function stopService(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  const closed = once(child, "close").then(() => undefined, () => undefined);
  child.kill("SIGTERM");
  await Promise.race([closed, delay(3_000)]);
  if (child.exitCode === null) {
    const killed = once(child, "close").then(() => undefined, () => undefined);
    child.kill("SIGKILL");
    await Promise.race([killed, delay(1_000)]);
  }
}
