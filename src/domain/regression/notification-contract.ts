export type DifyNotificationItem = {
  id:string; type:'summary'|'image';
  status:'pending'|'sending'|'sent'|'failed'|'uncertain'|'skipped';
  attempts:number; detail?:string; payloadDigest?:string;
};
export type DifyNotification = {
  status:'disabled'|'not-needed'|'sending'|'sent'|'failed'|'partial'|'uncertain';
  updatedAt:string; items:DifyNotificationItem[];
};
