/** A local, read-only data source. Credentials and record identifiers never enter this DTO. */
export type RegressionDatabaseBinding = 'department-supply-readonly';
export type DatabaseCheck = {id:string; title:string; status:'passed'|'failed'|'blocked'; detail:string};
export type RegressionDatabaseEvidence = {
  binding:RegressionDatabaseBinding;
  capturedAt:string;
  status:'passed'|'failed'|'blocked';
  summary?:{applications:number;goods:number;applicationsWithGoods:number;orphanGoods:number};
  checks:DatabaseCheck[];
};

/** This connection belongs to this test deployment, never to arbitrary uploaded sites. */
export function supportsDepartmentDatabase(targetUrl:string):boolean {
  try {const u=new URL(targetUrl);return u.origin==='https://cdn.yibentushu.com'&&/^\/test-sample-apply\/(?:index\.html)?$/.test(u.pathname);}catch{return false;}
}
