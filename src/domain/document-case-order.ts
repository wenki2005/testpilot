type OrderedCase = { id: string; dependsOnCaseIds?: string[] };
/** Visual order is editable, but may not contradict explicit prerequisite order. */
export function validateDocumentCaseOrder(cases: OrderedCase[]): void {
 const indexes=new Map(cases.map((item,index)=>[item.id,index]));
 if(indexes.size!==cases.length) throw new Error('用例 ID 重复，请修正后保存。');
 for(const [index,item] of cases.entries()) for(const prerequisite of item.dependsOnCaseIds ?? []) {
   const before=indexes.get(prerequisite);
   if(before===undefined) throw new Error(`用例 ${item.id} 的前置 ${prerequisite} 不存在；请先修正依赖。`);
   if(before>=index) throw new Error(`用例 ${item.id} 必须排在前置 ${prerequisite} 之后；请调整顺序或依赖。`);
 }
}
export function moveDocumentCase<T extends OrderedCase>(cases:T[],id:string,delta:-1|1):T[] {
 const index=cases.findIndex(item=>item.id===id), target=index+delta;
 if(index<0 || target<0 || target>=cases.length) return cases;
 const next=[...cases]; [next[index],next[target]]=[next[target]!,next[index]!];
 validateDocumentCaseOrder(next); return next;
}
export function insertDocumentCase<T extends OrderedCase>(cases:T[],item:T,anchorId?:string,position:'before'|'after'='after'):T[] {
 const anchor=anchorId===undefined ? cases.length-1 : cases.findIndex(row=>row.id===anchorId);
 if(anchorId!==undefined && anchor<0) throw new Error('插入位置已失效，请刷新用例列表。');
 const next=[...cases]; next.splice(anchor+(position==='after'?1:0),0,item);
 validateDocumentCaseOrder(next); return next;
}
