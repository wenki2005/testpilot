import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createProjectScriptRegistry } from '../../src/adapters/projects/project-script-registry.ts';
import { handleProjectScriptRoutes } from '../../src/interfaces/http/project-tests/project-script-routes.ts';

function httpRequest(method, body) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method; request.headers = {};
  return request;
}
function httpResponse() { return { writeHead(status){this.statusCode=status;}, end(body){this.body=body;} }; }

test('real project script registry keeps approved source candidates across versions and restart, behind review gate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tp-script-registry-'));
  try {
    const profilesDir = path.join(root, 'profiles'), projectRoot = path.join(root, 'project');
    const sourceRoot = path.join(root, 'fixture'); const artifactDir = path.join(root, 'artifacts');
    await Promise.all([mkdir(profilesDir,{recursive:true}),mkdir(projectRoot,{recursive:true}),mkdir(path.join(sourceRoot,'tests'),{recursive:true}),mkdir(artifactDir,{recursive:true})]);
    const baselineContent = 'export const baseline = true;\n';
    await writeFile(path.join(sourceRoot,'baseline.js'),baselineContent);
    await writeFile(path.join(sourceRoot,'tests','baseline.test.js'),"import test from 'node:test'; test('baseline',()=>{});\n");
    await writeFile(path.join(profilesDir,'fixture.json'),JSON.stringify({version:1,name:'Fixture',sourceRoot,scriptFiles:['baseline.js','tests/baseline.test.js'],suite:{version:1,name:'Fixture suite',cases:[{id:'baseline-case',title:'Profile baseline',command:{bin:'node',args:['--test','tests/baseline.test.js']}}]}}));
    const registryFile = path.join(artifactDir,'project-scripts.json');
    const profile = {id:'fixture',name:'Fixture',suiteName:'Fixture suite'};
    const createRegistry = () => createProjectScriptRegistry({projectRoot,profilesDir,artifactDir,registryFile,profiles:[profile],distributionDemo:false});
    const registry = createRegistry();
    const imported = (n) => { const provenance={runId:`run-${n}`,candidateDigest:`digest-${n}`,runtimeConclusion:n===1?'failed':'passed',assessmentSummary:`Assessment summary for run ${n}`,blockers:[`Confirm requirement interpretation for run ${n}.`],executions:[{id:`execution-${n}`,status:n===1?'failed':'passed',files:[`tests/candidate-${n}.test.js`],counts:{tests:1,fail:n===1?1:0},durationMs:12,evidenceId:`execution-${n}`}],evidenceIds:[`execution-${n}`],findings:[{caseId:`finding-${n}`,status:'failed',evidenceDescription:`Observed failure ${n}`,evidenceRefs:[`execution-${n}`],evidenceLinkStatus:'linked'}]}; return {runId:provenance.runId,candidateDigest:provenance.candidateDigest,runtimeConclusion:provenance.runtimeConclusion,sourceProvenance:provenance,suite:{version:1,name:`Source candidate ${n}`,cases:[{id:`candidate-${n}`,title:`Candidate ${n}`,command:{bin:'node',args:['--test',`tests/candidate-${n}.test.js`],cleanEnvironment:true}}]},files:{[`tests/candidate-${n}.test.js`]:`// candidate ${n}\n`}}; };
    const first = await registry.importSourceCandidate('fixture',imported(1));
    assert.equal(first.status,'candidate');
    let runnerCalls = 0;
    const routeDeps = {scripts:registry.scripts,view:registry.view,persist:registry.persist,isRunActive:()=>false,launchApproved:async()=>{runnerCalls++;return {started:true};}};
    const blockedRunResponse = httpResponse();
    await handleProjectScriptRoutes(httpRequest('POST'),blockedRunResponse,`/api/project-scripts/${first.id}/run`,routeDeps);
    assert.equal(blockedRunResponse.statusCode,409);
    assert.equal(runnerCalls,0);
    const reviewResponse = httpResponse();
    await handleProjectScriptRoutes(httpRequest('POST',{decision:'approve'}),reviewResponse,`/api/project-scripts/${first.id}/review`,routeDeps);
    assert.equal(reviewResponse.statusCode,200);
    assert.equal(runnerCalls,0,'approval must not launch a run');
    const approvedRunResponse = httpResponse();
    await handleProjectScriptRoutes(httpRequest('POST'),approvedRunResponse,`/api/project-scripts/${first.id}/run`,routeDeps);
    assert.equal(approvedRunResponse.statusCode,202);
    assert.equal(runnerCalls,1,'only explicit run after approval reaches runner');

    const second = await registry.importSourceCandidate('fixture',imported(2));
    assert.equal(second.status,'candidate');
    assert.equal(runnerCalls,1,'importing the second candidate does not run it');
    assert.deepEqual(second.cases.map(item=>item.id),['baseline-case','candidate-1','candidate-2']);
    const paths = second.files.map(item=>item.path);
    assert.ok(paths.includes('baseline.js'));
    assert.ok(paths.includes('tests/baseline.test.js'));
    assert.ok(paths.includes('tests/candidate-1.test.js'));
    assert.ok(paths.includes('tests/candidate-2.test.js'));

    const reloaded = createRegistry();
    await reloaded.load();
    const restored = reloaded.view(reloaded.scripts.get(second.id));
    assert.equal(restored.status,'candidate');
    assert.deepEqual(restored.cases.map(item=>item.id),['baseline-case','candidate-1','candidate-2']);
    assert.deepEqual(restored.files.map(item=>item.path).sort(),paths.sort());
    assert.deepEqual(restored.sourceProvenance, imported(2).sourceProvenance);
    assert.equal(restored.sourceProvenance.assessmentSummary,'Assessment summary for run 2');
    assert.deepEqual(restored.sourceProvenance.blockers,['Confirm requirement interpretation for run 2.']);

    const legacySuite={version:1,name:'Legacy baseline',cases:[{id:'legacy-case',title:'Legacy',command:{bin:'node',args:['--test','tests/baseline.test.js']}}]};
    const legacyFiles={'baseline.js':baselineContent,'tests/baseline.test.js':"import test from 'node:test'; test('baseline',()=>{});\n"};
    const legacy={id:'legacy-script',profileId:'fixture',profileName:'Fixture',suiteName:'Legacy baseline',version:1,status:'approved',origin:'registered-profile-snapshot',createdAt:'2026-01-01T00:00:00.000Z',digest:createHash('sha256').update(JSON.stringify({profileId:'fixture',suite:legacySuite,files:legacyFiles})).digest('hex'),suite:legacySuite,files:legacyFiles};
    await writeFile(registryFile,JSON.stringify([legacy]));
    const legacyReload=createRegistry();await legacyReload.load();
    assert.equal(legacyReload.scripts.get('legacy-script')?.status,'approved');
    assert.equal(legacyReload.scripts.get('legacy-script')?.sourceProvenance,undefined);
  } finally { await rm(root,{recursive:true,force:true}); }
});
