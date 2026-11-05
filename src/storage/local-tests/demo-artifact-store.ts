import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DemoCheck, DemoRun } from "../../compat/local-test-contract-exports.js";
import type { ProjectRunView } from "../../domain/projects/profile-contract.js";
/** File-backed demo/profile run artifacts. Recovery policy stays in the application/bootstrap layer. */
export function createDemoArtifactStore(input: {
    demoRunsDirectory: string;
    regressionsFile: string;
    projectRunsDirectory: string;
    renderDemoReport(run: DemoRun): string;
}) {
    const isSafeDirectoryName = (value: string) => Boolean(value) && value !== "." && value !== ".." && !/[\\/]/u.test(value);
    async function saveDemoRun(run: DemoRun): Promise<void> {
        const directory = path.join(input.demoRunsDirectory, run.id);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
        await writeFile(path.join(directory, "report.md"), input.renderDemoReport(run), "utf8");
    }
    async function saveRegressionChecks(checks: DemoCheck[]): Promise<void> {
        await mkdir(path.dirname(input.regressionsFile), { recursive: true });
        await writeFile(input.regressionsFile, `${JSON.stringify(checks, null, 2)}\n`, "utf8");
    }
    async function readRegressionChecks(): Promise<unknown> {
        try {
            return JSON.parse(await readFile(input.regressionsFile, "utf8")) as unknown;
        }
        catch {
            return undefined;
        }
    }
    async function listDemoRunSnapshots(): Promise<unknown[]> {
        const entries = await readdir(input.demoRunsDirectory, { withFileTypes: true }).catch(() => []);
        const snapshots: unknown[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            try {
                const item: unknown = JSON.parse(await readFile(path.join(input.demoRunsDirectory, entry.name, "run.json"), "utf8"));
                if (item && typeof item === "object" && "id" in item && item.id === entry.name)
                    snapshots.push(item);
            }
            catch { /* skip incomplete/corrupt entries */ }
        }
        return snapshots;
    }
    async function saveProfileRun(run: ProjectRunView): Promise<void> {
        const directory = path.join(input.projectRunsDirectory, run.id);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "profile-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
    }
    async function listProfileRunSnapshots(): Promise<unknown[]> {
        const entries = await readdir(input.projectRunsDirectory, { withFileTypes: true }).catch(() => []);
        const snapshots: unknown[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            try {
                const item: unknown = JSON.parse(await readFile(path.join(input.projectRunsDirectory, entry.name, "profile-run.json"), "utf8"));
                if (item && typeof item === "object" && "id" in item && item.id === entry.name)
                    snapshots.push(item);
            }
            catch { /* skip incomplete profile runs */ }
        }
        return snapshots;
    }
    async function listProfileRunFiles(id: string): Promise<string[]> {
        const base = path.join(input.projectRunsDirectory, id, "target-artifacts");
        const found: string[] = [];
        async function walk(directory: string): Promise<void> {
            for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
                const absolute = path.join(directory, entry.name);
                if (entry.isDirectory())
                    await walk(absolute);
                else if (entry.isFile())
                    found.push(path.relative(base, absolute).split(path.sep).join("/"));
            }
        }
        await walk(base);
        return found.sort();
    }
    async function readProfileRunArtifact(id: string, relativePath: string): Promise<Buffer> {
        if (!isSafeDirectoryName(id))
            throw new Error("invalid artifact path");
        const base = path.resolve(input.projectRunsDirectory, id, "target-artifacts");
        const parts = relativePath.split(/[\\/]+/u);
        if (!id || !parts.length || parts.some(part => !part || part === "." || part === ".."))
            throw new Error("invalid artifact path");
        const file = path.resolve(base, ...parts);
        if (!file.startsWith(`${base}${path.sep}`))
            throw new Error("invalid artifact path");
        const info = await stat(file);
        if (!info.isFile())
            throw new Error("artifact not found");
        return readFile(file);
    }
    async function readProfileRunReport(id: string, recordRunId: string, format: "md" | "json"): Promise<Buffer> {
        if (!isSafeDirectoryName(id) || !isSafeDirectoryName(recordRunId))
            throw new Error("invalid report path");
        const runs = path.resolve(input.projectRunsDirectory, id, "normalized");
        const run = path.resolve(runs, recordRunId);
        if (!id || !recordRunId || !run.startsWith(`${runs}${path.sep}`) || (format !== "md" && format !== "json"))
            throw new Error("invalid report path");
        const file = path.join(run, format === "md" ? "report.md" : "run.json");
        const info = await stat(file);
        if (!info.isFile())
            throw new Error("report not found");
        return readFile(file);
    }
    return { saveDemoRun, saveRegressionChecks, readRegressionChecks, listDemoRunSnapshots, saveProfileRun, listProfileRunSnapshots, listProfileRunFiles, readProfileRunArtifact, readProfileRunReport };
}
