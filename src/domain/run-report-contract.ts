import type {BatchView} from './system-module-contract.js';
export type ReportKind='batch'|'core';
export type ReportStatus='passed'|'failed'|'blocked'|'error'|'not_executed'|'outside';
export type ReportCounts=Record<ReportStatus,number>;
export type ReportMetadata={name:string;note:string;important:boolean;revision:number;updatedAt:string};
export type RunReport={key:string;id:string;kind:ReportKind;systemId:string;systemName:string;scope:'all'|'custom'|'core';name:string;metadata:ReportMetadata;createdAt:string;phase:string;size:number;groupCount:number;unit:'条'|'步';counts:ReportCounts;parentBatchId:string};
export type RunReportCatalog={systems:Array<{id:string;name:string}>;systemId:string;reports:RunReport[]};
export type ReportStep={id:string;title:string;expected:string;actual:string;status:ReportStatus;caseIds:string[];evidencePath:string;evidenceNote:string;nextAction:string};
export type ReportGroup={id:string;title:string;version:string;size:number;counts:ReportCounts;steps:ReportStep[]};
export type RunReportDetail={report:RunReport;environment:string;account:string;profileId:string;groups:ReportGroup[];message:string};
export const emptyReportCounts=():ReportCounts=>({passed:0,failed:0,blocked:0,error:0,not_executed:0,outside:0});
export function batchReportScope(b:Pick<BatchView,'scope'|'entries'>):'all'|'custom'{return b.scope==='all'&&b.entries.every(e=>!e.selectedCaseIds||e.selectedCaseIds.length===e.caseCount)?'all':'custom';}
