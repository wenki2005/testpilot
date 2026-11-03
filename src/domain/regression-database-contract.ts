/** A local, read-only data source. Credentials and record identifiers never enter this DTO. */
export type RegressionDatabaseBinding = 'department-supply-readonly';
export type DatabaseCheck = {id:string; title:string; status:'passed'|'failed'|'blocked'; detail:string};
/** Only aggregate facts; no account, application, approval or order identifiers. */
export type DepartmentBlockerInventory = {
  states:Array<{own:boolean;status:number;lockStatus:number;usage:number;count:number;multiLine:number;orderReferences:number}>;
  links:{applications:number;orderReferences:number;matchedOrders:number;matchingTemplates:number;linkedFailures:number;linkedOutbox:number;linkedLogistics:number};
  notificationFlags:{lockFailure:number;restock:number};
  configurationKeys:number;
};
export type RegressionDatabaseEvidence = {
  binding:RegressionDatabaseBinding;
  capturedAt:string;
  status:'passed'|'failed'|'blocked';
  summary?:{applications:number;goods:number;applicationsWithGoods:number;orphanGoods:number};
  blockerInventory?:DepartmentBlockerInventory;
  checks:DatabaseCheck[];
};

/** This connection belongs to this test deployment, never to arbitrary uploaded sites. */
export function supportsDepartmentDatabase(targetUrl:string):boolean {
  try {const u=new URL(targetUrl);return u.origin==='https://cdn.yibentushu.com'&&/^\/test-sample-apply\/(?:index\.html)?$/.test(u.pathname);}catch{return false;}
}
