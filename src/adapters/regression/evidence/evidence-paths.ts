import path from 'node:path';
import type {WebModuleJob} from '../execution/module-execution-service.js';

/** Resolve only evidence referenced by this job. Old authorized write jobs
 * predate the explicit origin field and retain their original screenshots. */
export function difyModuleEvidencePath(root:string,job:Pick<WebModuleJob,'id'|'results'|'documentRunId'|'authorizedWriteCaseIds'>,name:string):string|undefined {
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(job.id)||!(/^[0-9a-f]{64}\.png$/i).test(name))return;
 const row=job.results.find(r=>r.evidence===name);if(!row)return;
 const authorized=job.authorizedWriteCaseIds?.includes(row.caseId)===true;
 if(row.evidenceOrigin==='preflight'||authorized&&(row.evidenceOrigin==='authorized-write'||!row.evidenceOrigin))return path.join(root,'dify-web-modules','evidence',job.id,name);
 if(row.evidenceOrigin==='authorized-write')return;
 if(job.documentRunId&&uuid.test(job.documentRunId))return path.join(root,'document-tests','runs',job.documentRunId,'screenshots',name);
}
