import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectScriptOriginLabel, SourceProvenanceReview } from '../web/src/project-script-origin-label.tsx';
import { ImportedCandidateNotice, SourceCandidatePreview } from '../web/src/source-tests-page.tsx';

test('source-agent script candidate is labeled as a pending-review source', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectScriptOriginLabel, { origin: 'source-agent-candidate' }));
  assert.match(html, /源码测试 Agent 候选（来源待审）/);
  assert.match(html, /data-origin="source-agent-candidate"/);
  assert.doesNotMatch(html, /已批准|已审核|正确/);
});

test('successful adoption gives a direct path to the pending script review list', () => {
  const html = renderToStaticMarkup(React.createElement(ImportedCandidateNotice, { onOpen: () => {} }));
  assert.match(html, /已导入为待审核脚本版本/);
  assert.match(html, /查看待审核版本/);
  assert.match(html, /尚未批准或执行/);
});

test('review SSR retains source run, execution conclusion, verified references and unlinked pending findings', () => {
  const provenance={runId:'run-123',candidateDigest:'sha256-candidate',runtimeConclusion:'failed',assessmentSummary:'Boundary behavior differs from observed implementation.',blockers:['Requirement owner must confirm the upper bound.'],executions:[{id:'execution-1',status:'failed',files:['tests/a.test.js'],evidenceId:'execution-1'}],evidenceIds:['execution-1','tool-1'],findings:[{caseId:'C-1',status:'failed',evidenceDescription:'Observed output needs review',evidenceRefs:['execution-1'],evidenceLinkStatus:'linked'},{caseId:'C-2',status:'observed',evidenceDescription:'Free text awaiting linkage',evidenceRefs:[],evidenceLinkStatus:'unlinked-pending-review'}]};
  const html=renderToStaticMarkup(React.createElement(SourceProvenanceReview,{provenance}));
  assert.match(html,/run-123/);assert.match(html,/sha256-candidate/);assert.match(html,/执行结论：failed/);
  assert.match(html,/Boundary behavior differs from observed implementation/);assert.match(html,/Requirement owner must confirm the upper bound/);
  assert.match(html,/已核验引用：execution-1/);assert.match(html,/未关联待审/);assert.match(html,/Free text awaiting linkage/);
  assert.doesNotMatch(html,/已批准|已审核|正确/);
});

test('pre-import candidate preview exposes assessment summary and every blocker without approving', () => {
  const candidate={profileId:'synthetic-profile',files:{'tests/boundary.test.js':'// synthetic'},cases:[{id:'case-1',title:'Boundary candidate',file:'tests/boundary.test.js',fileDigest:'digest',command:{bin:'node',args:['--test','tests/boundary.test.js']}}],provenance:{runId:'run-preview',candidateDigest:'candidate-digest',runtimeConclusion:'failed',assessmentSummary:'Observed behavior needs a confirmed requirement.',blockers:['Confirm valid lower bound.','Confirm valid upper bound.'],evidenceIds:['tool-1'],findings:[]}};
  const html=renderToStaticMarkup(React.createElement(SourceCandidatePreview,{candidate,onImport:()=>{}}));
  assert.match(html,/Observed behavior needs a confirmed requirement/);assert.match(html,/Confirm valid lower bound/);assert.match(html,/Confirm valid upper bound/);
  assert.match(html,/导入为待审核版本/);assert.doesNotMatch(html,/自动批准|已批准/);
});

test('legacy persisted source versions show a clear missing-assessment fallback', () => {
  const provenance={runId:'legacy-run',candidateDigest:'legacy-digest',runtimeConclusion:'passed',executions:[],evidenceIds:[],findings:[]};
  const html=renderToStaticMarkup(React.createElement(SourceProvenanceReview,{provenance}));
  assert.match(html,/旧版版本未保留评估摘要/);
});
