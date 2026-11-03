import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, lstat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { runSourceAgentLoop, type SourceAgentDriver } from './source-agent-loop.js';
import { executeCommand } from './command-adapter.js';
import { boundedObservation, nodeFailurePreview, nodeTestSummary } from './source-agent-evidence.js';
import { createRequire } from 'node:module';
import { rgPath } from '@vscode/ripgrep';
import { appendFile } from 'node:fs/promises';
import { prepareProfile } from './project-profile-adapter.js';
import { redactSensitiveExportData, redactSensitiveExportText } from './document-sensitive-data.js';
import type { SourceTestAssessment, SourceTestMode, SourceTestRun } from '../domain/source-test.js';

const finding = z.object({ caseId: z.string(), status: z.enum(['observed', 'failed', 'blocked']), expected: z.string(), actual: z.string(), evidence: z.string() }).strict();
const assessment = z.object({ summary: z.string(), findings: z.array(finding), blockers: z.array(z.string()), proposedTests: z.array(z.object({ id: z.string(), title: z.string(), bin: z.string(), args: z.array(z.string()) }).strict()) }).strict();
export type { SourceTestAssessment, SourceTestRun } from '../domain/source-test.js';
export type SourceTestRequest = { sourceRoot: string; goal: string; mode: SourceTestMode; outputRoot: string; candidateFiles?: string[]; timeoutMs?: number; signal?: AbortSignal; onProgress?: (event: { type: string; itemType?: string; exitCode?: number }) => void };

/** Source inspection and candidate generation using TestPilot own model and tools. */
export async function runSourceTestAgent(request: SourceTestRequest, driver: SourceAgentDriver = runSourceAgentLoop): Promise<SourceTestRun> {
  if (!['plan', 'generate', 'diagnose'].includes(request.mode)) throw Error('Unknown test-agent mode');
  if (!request.goal.trim() || request.goal.length > 30000) throw Error('A test goal of 1–30000 characters is required');
  const timeoutMs = request.timeoutMs ?? 300000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000) throw Error('Test-agent timeout must be 1000–900000 ms');
  const id = randomUUID();
  const folder = path.resolve(request.outputRoot, id);
  const source = path.resolve(request.sourceRoot);
  const relOutput = path.relative(source, path.resolve(request.outputRoot));
  const exclude = ['artifacts', 'test-artifacts', 'output', 'dist', 'web/dist', '.vite', '.codex', '.npmrc', '.pypirc', '.ssh', '.aws', '.azure', '.venv'];
  if (relOutput && !relOutput.startsWith('..') && !path.isAbsolute(relOutput)) exclude.push(relOutput.replaceAll('\\', '/'));
  const prepared = await prepareProfile({ version: 1, name: 'TestPilot source snapshot', sourceRoot: source, excludePaths: exclude, suite: { version: 1, name: 'Candidate only', cases: [] } });
  await mkdir(folder, { recursive: true });
  const workspacePath = path.join(folder, 'workspace');
  const startedAt = new Date().toISOString();
  const reportPath = path.join(folder, 'report.md');
  const run: SourceTestRun = { id, goal:redactSensitiveExportText(request.goal), candidateFiles:[...(request.candidateFiles??[])], status: 'blocked', executionState: 'running', mode: request.mode, startedAt, completedAt: startedAt, reportPath, workspacePath, changedFiles: [], protectedChanges: [], toolCalls: 0, modelRequests: 0, usage: {input:0,output:0}, runtimeStatus:'not-run', executions:[], evidenceIds:[], commandCount: 0, successfulCommands: 0, limitations: ['Agent completion is a test candidate, not a verified regression pass.', 'Source is copied without node_modules, environment files or symlinks; dependency availability must be established.', 'Generated Node tests run in a disposable source copy with a clean environment. This is not an OS sandbox; use trusted isolated test projects.', 'Generated code and tests require review and a separate deterministic run before adoption.'] };
  const checkpoint = () => writeFile(path.join(folder, 'run.json'), JSON.stringify(redactSensitiveExportData(run), null, 2));
  await checkpoint();
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal?.reason ?? new Error('Test-agent cancelled'));
  request.signal?.addEventListener('abort', abort, { once: true });
  if (request.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('Test-agent time budget exceeded')), timeoutMs);
  const evidence = new Map<string, string>();
  try {
    if (controller.signal.aborted) throw Error('Test-agent cancelled before execution');
    const before = await snapshot(prepared.projectRoot);
    let calls = 0, observedBytes = 0, submitted = false;
    const tools: AgentTool[] = [];
    const sourceFiles = [...before.keys()].sort();
    const newTests = new Set<string>();
    // Only caller-designated files from a previous agent candidate may be
    // revised. Business source and ordinary existing tests stay protected.
    const editableCandidates = new Set((request.candidateFiles??[]).filter(name=>before.has(name)&&/^(tests|specs|e2e)\/.*\.(?:[cm]?[jt]sx?|py)$/.test(name)));
    const executedHashes = new Map<string,string>();
    const executionCache=new Map<string,unknown>();
    const latestExecutionStates=new Map<string,string>();
    const tool = (name: string, description: string, parameters: any, execute: (params: any) => Promise<unknown>) => {
      tools.push({ name, label: name, description, parameters, execute: async (_id, params) => {
        if (controller.signal.aborted) throw controller.signal.reason ?? Error('Source agent cancelled');
        if (++calls > 40) { controller.abort(new Error('Source-agent tool budget exceeded')); throw controller.signal.reason; }
        run.toolCalls = calls;
        if (submitted) throw Error('Assessment already submitted');
        request.onProgress?.({ type: 'tool.started', itemType: name });
        const started = Date.now(), evidenceId = 'tool-' + calls;
        try {
          const result = redactSensitiveExportData(await execute(params));
          const raw = JSON.stringify(result);
          evidence.set(evidenceId, raw);
          await writeFile(path.join(folder,evidenceId+'.json'),raw);
          await appendFile(path.join(folder,'events.jsonl'),JSON.stringify({evidenceId,name,status:'completed',durationMs:Date.now()-started})+'\n');
          await checkpoint();
          return { content: [{ type: 'text' as const, text: JSON.stringify({evidenceId,...boundedObservation(raw)}) }], details: {evidenceId} };
        } catch (error) {
          await appendFile(path.join(folder,'events.jsonl'),JSON.stringify({evidenceId,name,status:'error',error:redactSensitiveExportText(String(error)),durationMs:Date.now()-started})+'\n');
          throw error;
        }
      }});
    };
    const localPath = (value: string) => {
      if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.split('/').some(p => p === '..' || p === '.' || !p) || path.isAbsolute(value)) throw Error('Invalid workspace-relative path');
      const resolved = path.resolve(prepared.projectRoot, value);
      const rel = path.relative(prepared.projectRoot, resolved);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Path outside source snapshot');
      return resolved;
    };
    tool('list_files', 'List source snapshot files; pages contain at most 200 paths.', Type.Object({offset:Type.Optional(Type.Integer({minimum:0}))}), async ({offset=0}) => {
      const files = [...sourceFiles,...newTests].sort();
      return { files: files.slice(offset, offset + 200), total: files.length, nextOffset: offset+200 < files.length ? offset+200 : null };
    });
    tool('read_file', 'Read up to 16000 characters from a source file. Use offset to continue.', Type.Object({path:Type.String(),offset:Type.Optional(Type.Integer({minimum:0}))}), async ({path: name,offset=0}) => {
      const file = localPath(name);
      if (!Number.isInteger(offset) || offset<0) throw Error('Invalid read offset');
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size>2000000) throw Error('Not a supported text file (max 2MB)');
      const value = await readFile(file,'utf8');
      if (value.includes('\0')) throw Error('Binary source is unsupported');
      const text = value.slice(offset,offset+16000);
      observedBytes += text.length;
      if (observedBytes>120000) throw Error('Source observation budget exceeded; narrow the testing goal');
      return {path:name,text,totalCharacters:value.length,nextOffset:offset+text.length<value.length?offset+text.length:null};
    });
    tool('write_test', 'Create one new test file in tests/, specs/ or e2e/. Existing files cannot be overwritten.', Type.Object({path:Type.String(),content:Type.String({maxLength:64000})}), async ({path:name,content}) => {
      if (request.mode!=='generate') throw Error('This mode cannot write files');
      const file = localPath(name);
      if (!/^(tests|specs|e2e)\//.test(name) || !/\.(?:[cm]?[jt]sx?|py|md|json)$/.test(name) || typeof content!=='string' || content.length>64000) throw Error('Unsupported new test file');
      await mkdir(path.dirname(file),{recursive:true});
      await writeFile(file,content,{flag:'wx'});
      newTests.add(name);
      if(!run.candidateFiles.includes(name))run.candidateFiles.push(name);
      return {path:name,status:'candidate',executed:false};
    });
    tool('search_source', 'Literal source search with ripgrep. Search before reading whole files; no shell or regex expansion.', Type.Object({query:Type.String({minLength:1,maxLength:200})}), async ({query}) => {
      if(typeof query!=='string' || !query || query.length>200) throw Error('Invalid search query');
      const result=await executeCommand({id:'source-search',title:'ripgrep source search',command:{bin:rgPath,args:['--line-number','--fixed-strings','--max-count','20','--glob','!node_modules/**','--glob','!.git/**','--',query,'.'],cleanEnvironment:true,timeoutMs:10000}},prepared.projectRoot,controller.signal);
      return {exitCode:result.actualExitCode,matches:result.evidence.filter(e=>e.kind==='stdout').map(e=>e.content).join('\n'),error:result.error??null};
    });
    tool('revise_test', 'Repair a demonstrably incorrect agent-generated candidate with source-grounded reasoning. Preserve before/after evidence. Cannot edit ordinary existing tests or application code.', Type.Object({path:Type.String(),content:Type.String({maxLength:64000}),reason:Type.String({minLength:20,maxLength:2000}),requirementRef:Type.String({minLength:3,maxLength:300})}), async ({path:name,content,reason,requirementRef})=>{
      if(request.mode!=='generate'||(!newTests.has(name)&&!editableCandidates.has(name)))throw Error('Only this agent candidate can be revised');
      if(typeof content!=='string'||content.length>64000||typeof reason!=='string'||reason.length<20||typeof requirementRef!=='string'||requirementRef.length<3)throw Error('Grounded revision details are required');
      if(/\b(?:test|describe|it)\s*\.\s*(?:skip|todo|fixme)\s*\(/.test(content))throw Error('A candidate revision cannot skip tests');
      const file=localPath(name),previous=await readFile(file,'utf8');
      await writeFile(path.join(folder,'revision-'+calls+'.json'),JSON.stringify(redactSensitiveExportData({path:name,reason,requirementRef,before:previous,after:content}),null,2));
      await writeFile(file,content);executedHashes.delete(name);
      return {path:name,status:'revised-candidate',requiresRerun:true};
    });
    tool('read_evidence', 'Recover a previous full observation by evidenceId, using offset for pagination.', Type.Object({evidenceId:Type.String(),offset:Type.Optional(Type.Integer({minimum:0})),length:Type.Optional(Type.Integer({minimum:100,maximum:12000}))}), async ({evidenceId,offset=0,length=3000}) => {
      const raw=evidence.get(evidenceId); if(raw===undefined)throw Error('Unknown evidence ID');
      if(!Number.isInteger(offset)||offset<0)throw Error('Invalid evidence offset');
      if(!Number.isInteger(length)||length<100||length>12000)throw Error('Invalid evidence page length');
      return {evidenceId,text:raw.slice(offset,offset+length),totalCharacters:raw.length,nextOffset:offset+length<raw.length?offset+length:null};
    });
    tool('run_tests', 'Execute explicit Node test files inside the snapshot, inspect TAP counts and return real failures. Run again after adding grounded checks; do not modify business code or weaken tests.', Type.Object({files:Type.Array(Type.String(),{minItems:1,maxItems:20}),rerunReason:Type.Optional(Type.String({minLength:10,maxLength:200}))}), async ({files,rerunReason}) => {
      if(request.mode==='plan')throw Error('Plan mode does not execute tests');
      if(!Array.isArray(files)||!files.length||files.length>20)throw Error('Select 1–20 Node test files');
      for(const name of files){const file=localPath(name);if(!/^(tests|specs|e2e)\/.*\.(?:[cm]?js)$/.test(name)||!(await lstat(file)).isFile())throw Error('Only explicit Node test files can run');}
      if(run.commandCount>=6)throw Error('Test execution budget exhausted (6)');
      const testHashes = new Map(await Promise.all(files.map(async name=>[name,createHash('sha256').update(await readFile(localPath(name))).digest('hex')] as const)));
      const signature=JSON.stringify([...testHashes].sort((a,b)=>a[0].localeCompare(b[0])));
      if(executionCache.has(signature)&&!rerunReason)return {...executionCache.get(signature) as object,cached:true,note:'Unchanged tests: reused actual prior evidence. Add independent tests or provide a concrete rerunReason.'};
      const executionId='execution-'+(++run.commandCount);
      const require=createRequire(import.meta.url);
      const dependencyRoot=path.dirname(path.dirname(require.resolve('playwright/package.json')));
      const result=await executeCommand({id:executionId,title:'Agent Node regression',command:{bin:process.execPath,args:['--test','--test-reporter=tap',...files],cleanEnvironment:true,env:{NODE_PATH:dependencyRoot,TESTPILOT_TEST_OUTPUT_DIR:path.join(folder,'test-output')},timeoutMs:45000}},prepared.projectRoot,controller.signal);
      const captured=JSON.stringify(redactSensitiveExportData(result));
      evidence.set(executionId,captured);
      await writeFile(path.join(folder,executionId+'.json'),captured);
      for(const [name,digest] of testHashes){
        if(createHash('sha256').update(await readFile(localPath(name))).digest('hex')!==digest){controller.abort(Error('A running test modified its own candidate: '+name));throw controller.signal.reason;}
        executedHashes.set(name,digest);
      }
      const stdout=result.evidence.filter(e=>e.kind==='stdout').map(e=>e.content).join('\n');
      const normalized=nodeTestSummary(stdout,result.actualExitCode??null);
      if(result.status==='blocked'||result.status==='error'||result.evidence.some(e=>e.kind==='timeout'))normalized.status='blocked';
      if(normalized.status==='passed')run.successfulCommands++;
      const evidenceId='tool-'+calls;
      run.executions.push({id:executionId,files,status:normalized.status,durationMs:result.durationMs,counts:normalized.counts,evidenceId});
      for(const file of files)latestExecutionStates.set(file,normalized.status);
      run.runtimeStatus=[...latestExecutionStates.values()].includes('failed')?'failed':[...latestExecutionStates.values()].includes('blocked')?'blocked':'passed';
      const afterRun=await snapshot(prepared.projectRoot);
      const protectedChanges=[...new Set([...before.keys(),...afterRun.keys()])].filter(name=>before.get(name)!==afterRun.get(name)&&!newTests.has(name)&&!editableCandidates.has(name));
      if(protectedChanges.length){run.protectedChanges=protectedChanges;controller.abort(Error('Test execution changed protected files: '+protectedChanges.join(', ')));throw controller.signal.reason;}
      const observation={executionId,outputEvidenceId:executionId,captureLimitBytesPerStream:1000000,status:normalized.status,counts:normalized.counts,exitCode:result.actualExitCode,durationMs:result.durationMs,failedTests:nodeFailurePreview(stdout),outputPreview:boundedObservation(stdout,2400),stderr:boundedObservation(result.evidence.filter(e=>e.kind==='stderr').map(e=>e.content).join('\n'),1000),error:result.error??null};
      executionCache.set(signature,observation);
      return observation;
    });
    tool('submit_assessment', 'Submit structured findings. Static analysis is observed, never a runtime pass.', Type.Unsafe(z.toJSONSchema(assessment)), async params => {
      const parsed=assessment.parse(params);
      if(request.mode==='generate' && [...newTests,...editableCandidates].some(name=>/\.(?:[cm]?js)$/.test(name)&&!executedHashes.has(name)))throw Error('Run all generated Node tests before submitting assessment');
      if(request.mode==='generate' && newTests.size && !run.executions.length)throw Error('Run generated tests before submitting assessment');
      if(parsed.findings.some(f=>f.status==='failed') && !run.executions.some(e=>e.status==='failed'))throw Error('A failed finding requires runtime failure evidence');
      run.assessment=parsed; submitted=true; return {accepted:true,runtimeStatus:run.runtimeStatus};
    });
    await driver({tools,isComplete:()=>submitted,signal:controller.signal,onUsage:usage=>{run.modelRequests++;run.usage.input+=usage.input;run.usage.output+=usage.output;},...(request.onProgress ? {onProgress:request.onProgress} : {}),prompt:
      'Editable prior candidate files: '+[...editableCandidates].join(', ')+'\nMode: '+request.mode+'\nUser testing goal:\n'+request.goal+'\nInspect the copied project using list_files/read_file. Generate mode may use write_test. Finish with submit_assessment. Use search_source to find relevant code. Node tests can use built-ins. CommonJS .cjs tests can require("playwright") through the provided NODE_PATH; for local UI tests use installed Edge with channel=msedge, headless=true, and always close the browser in finally. Save screenshots or other generated artifacts under process.env.TESTPILOT_TEST_OUTPUT_DIR. This is available without installing dependencies. Generate mode MUST run_tests on all new tests before submit_assessment. Read failures, investigate source, add independent checks when useful and run again. Never repair the app or weaken assertions. Include tool evidence IDs in findings. Proposed commands remain candidates; executions record actual evidence.'});
    if (controller.signal.aborted) throw controller.signal.reason ?? Error('Source agent cancelled');
    if (!submitted || !run.assessment) throw Error('Agent did not submit a valid assessment');
    const after = await snapshot(prepared.projectRoot);
    run.changedFiles = [...new Set([...before.keys(), ...after.keys()])].filter(name => before.get(name) !== after.get(name));
    run.protectedChanges = run.changedFiles.filter(name => (before.has(name)&&!editableCandidates.has(name)) || !/^(tests|specs|e2e)\//.test(name) || !/\.(?:[cm]?[jt]sx?|py|md|json)$/.test(name));
    if (run.protectedChanges.length) throw Error(`Agent changed protected source or existing files: ${run.protectedChanges.join(', ')}`);
    const written = run.changedFiles.filter(name => after.has(name));
    if (request.mode === 'generate' && !written.length) throw Error('No new test files were produced; generation remains blocked');
    const candidateFiles = [...new Set(run.candidateFiles)].sort();
    const candidateFileDigests: Record<string, string> = {};
    for (const name of candidateFiles) {
      if (!/^(tests|specs|e2e)\/.*\.(?:[cm]?js)$/.test(name) || !executedHashes.has(name)) throw Error(`Candidate file lacks a current execution: ${name}`);
      const content = await readFile(localPath(name));
      const fileDigest = createHash('sha256').update(content).digest('hex');
      if (fileDigest !== executedHashes.get(name)) throw Error(`Candidate file changed after execution: ${name} (${fileDigest.slice(0,8)} != ${(executedHashes.get(name) ?? 'missing').slice(0,8)})`);
      const latestStatus = latestExecutionStates.get(name);
      if (!latestStatus || !['passed', 'failed'].includes(latestStatus)) throw Error(`Candidate file has no interpretable execution: ${name}`);
      candidateFileDigests[name] = fileDigest;
    }
    run.candidateFileDigests = candidateFileDigests;
    run.candidateFilesDigest = createHash('sha256').update(JSON.stringify(candidateFileDigests)).digest('hex');
    run.candidateDigest = run.candidateFilesDigest;
    run.status = 'candidate';
  } catch (error) {
    run.error = redactSensitiveExportText(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);
    let preserved = false;
    try { await cp(prepared.projectRoot, workspacePath, { recursive: true, filter: async file => !(await lstat(file)).isSymbolicLink() }); preserved = true; }
    catch { run.status = 'blocked'; run.error = 'Candidate workspace could not be preserved; inspect the retained temporary copy.'; run.limitations.push(`Retained temporary copy: ${prepared.projectRoot}`); }
    if (preserved) {
      try { await prepared.close(); }
      catch { run.limitations.push(`Temporary workspace cleanup was incomplete; retained path: ${path.dirname(prepared.projectRoot)}`); }
    }
  }
  run.completedAt = new Date().toISOString();
  run.executionState = 'completed';
  run.evidenceIds = [...evidence.keys()].sort();
  const safeRun = redactSensitiveExportData(run) as SourceTestRun;
  await writeFile(path.join(folder, 'run.json'), JSON.stringify(safeRun, null, 2));
  await writeFile(reportPath, `# TestPilot 源码测试分析与候选\n\n状态：${safeRun.status}\n\n${safeRun.assessment?.summary ?? safeRun.error ?? '未得到可判定结果'}\n\n运行判定：${run.runtimeStatus}；工具调用：${run.toolCalls}；模型请求：${run.modelRequests}；模型报告输入/输出 token：${run.usage.input}/${run.usage.output}。\n\n命令完成数：${run.commandCount}；退出码为零：${run.successfulCommands}。命令退出成功不等于业务验收通过。\n\n候选工作区：${workspacePath}\n\n${safeRun.limitations.map(x => '- ' + x).join('\n')}\n\n\`run.json\` 保留发现、阻塞、文件变更与候选摘要。\n`);
  if (safeRun.status === 'candidate' && Object.keys(safeRun.candidateFileDigests ?? {}).length) {
    // Keep proposed regression assets attached to the evidence that produced
    // them. A generated suite is always pending review, even when its tests ran.
    const suitePath = path.join(folder, 'suite.candidate.json');
    const suiteTemporaryPath = suitePath + '.tmp';
    await writeFile(suiteTemporaryPath, JSON.stringify({
      version: 1,
      name: 'TestPilot generated regression candidate — review required',
      assetStatus: 'candidate',
      reviewStatus: 'pending-review',
      provenance: {
        runId: safeRun.id,
        goal: safeRun.goal,
        candidateDigest: safeRun.candidateDigest,
        runtimeConclusion: safeRun.runtimeStatus,
        executions: safeRun.executions.map(execution => ({ id: execution.id, status: execution.status, evidenceId: execution.evidenceId })),
        evidenceIds: [...evidence.keys()].sort(),
        findings: (safeRun.assessment?.findings ?? []).map(finding => {
          const evidenceRefs = [...finding.evidence.matchAll(/\b(?:tool-\d+|execution-\d+)\b/g)]
            .map(match => match[0]).filter((id, index, ids) => ids.indexOf(id) === index && evidence.has(id));
          return {
            caseId: finding.caseId,
            status: finding.status,
            evidenceDescription: finding.evidence,
            evidenceRefs,
            evidenceLinkStatus: evidenceRefs.length ? 'linked' : 'unlinked-pending-review',
          };
        }),
      },
      cases: Object.entries(safeRun.candidateFileDigests ?? {}).map(([file, fileDigest], index) => ({ id:`source-${index + 1}`,title:`Node regression: ${file}`,file,fileDigest,command:{bin:'node',args:['--test',file],cleanEnvironment:true,timeoutMs:120000} })),
    }, null, 2));
    await rename(suiteTemporaryPath, suitePath);
  }
  return safeRun;
}

async function snapshot(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), rel = path.relative(root, file).replaceAll('\\', '/');
      if (entry.isSymbolicLink() || (await lstat(file)).isSymbolicLink()) throw Error('Symlinks are not supported in candidate workspaces');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) result.set(rel, createHash('sha256').update(await readFile(file)).digest('hex'));
    }
  };
  await visit(root);
  return result;
}

export async function loadSourceResume(runFile: string) {
  const folder=path.dirname(path.resolve(runFile));
  const previous=JSON.parse(await readFile(runFile,'utf8')) as SourceTestRun;
  const sourceRoot=path.join(folder,'workspace');
  if(previous.executionState!=='completed'||path.resolve(previous.workspacePath)!==sourceRoot)throw Error('Run is not a resumable owned workspace');
  const candidates=new Set(previous.candidateFiles??[]);
  for(const file of await readdir(folder))if(/^tool-\d+\.json$/.test(file)){
    const entry=JSON.parse(await readFile(path.join(folder,file),'utf8'));
    if(['candidate','revised-candidate'].includes(entry.status)&&typeof entry.path==='string')candidates.add(entry.path);
  }
  return {sourceRoot,goal:previous.goal??'',mode:previous.mode,candidateFiles:[...candidates].filter(name=>/^(tests|specs|e2e)\/.*\.(?:[cm]?[jt]sx?|py)$/.test(name)&&!name.split('/').includes('..'))};
}
