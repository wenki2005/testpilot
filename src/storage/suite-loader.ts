import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectProfile, TestSuite } from "../domain/types.js";

export async function loadSuite(path: string): Promise<TestSuite> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.name !== "string" || !Array.isArray(parsed.cases)) {
    throw new Error("Invalid suite: expected { version: 1, name: string, cases: [] }");
  }
  const cases = parsed.cases.map((item, index) => validateCase(item, index));
  return {
    version: 1,
    name: parsed.name,
    ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
    cases,
  };
}

export async function loadProjectProfile(path: string): Promise<ProjectProfile> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.name !== "string" || typeof parsed.sourceRoot !== "string" || !isRecord(parsed.suite)) {
    throw new Error("Invalid project profile: expected version, name, sourceRoot and suite");
  }
  const suite = parsed.suite;
  if (suite.version !== 1 || typeof suite.name !== "string" || !Array.isArray(suite.cases)) throw new Error("Invalid project profile suite");
  const cases = suite.cases.map((item, index) => validateCase(item, index));
  let service: ProjectProfile["service"];
  if (parsed.service !== undefined) {
    const candidate = parsed.service;
    if (!isRecord(candidate) || typeof candidate.bin !== "string" || !Array.isArray(candidate.args) || !candidate.args.every((arg) => typeof arg === "string") || typeof candidate.healthUrl !== "string") {
      throw new Error("Invalid profile service: expected bin, args and healthUrl");
    }
    const env = candidate.env;
    if (env !== undefined && (!isRecord(env) || !Object.values(env).every((entry) => typeof entry === "string"))) throw new Error("Invalid profile service env");
    service = { bin: candidate.bin, args: candidate.args, healthUrl: candidate.healthUrl, ...(env ? { env: env as Record<string, string> } : {}), ...(typeof candidate.startupTimeoutMs === "number" ? { startupTimeoutMs: candidate.startupTimeoutMs } : {}) };
  }
  const preserveArtifacts = parsed.preserveArtifacts;
  if (preserveArtifacts !== undefined && (!Array.isArray(preserveArtifacts) || !preserveArtifacts.every((item) => typeof item === "string"))) throw new Error("Invalid preserveArtifacts");
  const scriptFiles = parsed.scriptFiles;
  if (scriptFiles !== undefined && (!Array.isArray(scriptFiles) || !scriptFiles.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\\") && !item.startsWith("/") && !/^[A-Za-z]:/.test(item) && item.split("/").every((part) => part !== "" && part !== "." && part !== "..")))) throw new Error("Invalid scriptFiles: use safe project-relative paths with forward slashes");
  const optionalScriptFiles = parsed.optionalScriptFiles;
  if (optionalScriptFiles !== undefined && (!Array.isArray(optionalScriptFiles) || !optionalScriptFiles.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\\") && !item.startsWith("/") && !/^[A-Za-z]:/.test(item) && item.split("/").every((part) => part !== "" && part !== "." && part !== "..")))) throw new Error("Invalid optionalScriptFiles");
  const excludePaths = parsed.excludePaths;
  if (excludePaths !== undefined && (!Array.isArray(excludePaths) || !excludePaths.every((item) => typeof item === "string" && item.length > 0 && !item.includes("\\") && !item.startsWith("/") && !/^[A-Za-z]:/.test(item) && item.split("/").every((part) => part !== "" && part !== "." && part !== "..")))) throw new Error("Invalid excludePaths: use safe project-relative paths with forward slashes");
  return { version: 1, name: parsed.name, sourceRoot: parsed.sourceRoot, suite: { version: 1, name: suite.name, cases }, ...(service ? { service } : {}), ...(scriptFiles ? { scriptFiles } : {}), ...(optionalScriptFiles ? { optionalScriptFiles } : {}), ...(excludePaths ? { excludePaths } : {}), ...(preserveArtifacts ? { preserveArtifacts } : {}) };
}

function validateCase(value: unknown, index: number): TestSuite["cases"][number] {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" || !isRecord(value.command)) {
    throw new Error(`Invalid suite case at index ${index}`);
  }
  const command = value.command;
  if (typeof command.bin !== "string" || !Array.isArray(command.args) || !command.args.every((arg) => typeof arg === "string")) {
    throw new Error(`Case ${value.id}: command must include a bin and string args`);
  }
  const env = command.env;
  if (env !== undefined && (!isRecord(env) || !Object.values(env).every((entry) => typeof entry === "string"))) {
    throw new Error(`Case ${value.id}: env must be a string map`);
  }
  return {
    id: value.id,
    title: value.title,
    command: {
      bin: command.bin,
      args: command.args,
      ...(typeof command.cwd === "string" ? { cwd: command.cwd } : {}),
      ...(env ? { env: env as Record<string, string> } : {}),
      ...(typeof command.timeoutMs === "number" ? { timeoutMs: command.timeoutMs } : {}),
      ...(typeof command.expectedExitCode === "number" ? { expectedExitCode: command.expectedExitCode } : {}),
      ...(typeof command.cleanEnvironment === "boolean" ? { cleanEnvironment: command.cleanEnvironment } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveProjectRoot(value: string | undefined): string {
  return resolve(value ?? process.cwd());
}
