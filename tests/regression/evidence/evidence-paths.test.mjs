import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {difyModuleEvidencePath as resolve} from '../../../dist/adapters/regression/evidence/evidence-paths.js';

test('job-bound evidence covers authorized writes including existing jobs, preflight and document runs',()=>{
 const id='6c04c59c-4596-4bf6-b3d0-1b9f81e37eec',run='f0000000-0000-4000-8000-000000000001',name='a'.repeat(64)+'.png',root=path.resolve('synthetic-evidence');
 const job={id,authorizedWriteCaseIds:['xmind-39'],results:[{caseId:'xmind-39',evidence:name,evidenceOrigin:'authorized-write'}]};
 const local=path.join(root,'dify-web-modules','evidence',id,name);
 assert.equal(resolve(root,job,name),local);
 delete job.results[0].evidenceOrigin;assert.equal(resolve(root,job,name),local);
 job.results[0].evidenceOrigin='preflight';delete job.authorizedWriteCaseIds;assert.equal(resolve(root,job,name),local);
 job.results[0].evidenceOrigin='document-run';job.documentRunId=run;assert.equal(resolve(root,job,name),path.join(root,'document-tests','runs',run,'screenshots',name));
 job.results[0].evidenceOrigin='authorized-write';assert.equal(resolve(root,job,name),undefined);
 delete job.documentRunId;delete job.results[0].evidenceOrigin;assert.equal(resolve(root,job,name),undefined);
 for(const value of ['../'+name,'b'.repeat(64)+'.png','a'.repeat(64)+'.txt'])assert.equal(resolve(root,job,value),undefined);
 job.results[0].evidenceOrigin='preflight';job.id='../escape';assert.equal(resolve(root,job,name),undefined);
});
