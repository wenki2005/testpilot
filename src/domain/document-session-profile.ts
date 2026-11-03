/** Non-secret role metadata for an isolated persistent browser profile. */
export type DocumentSessionProfile = {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

export function documentSessionProfileKey(projectId: string, profileId?: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(projectId)) throw new Error('项目 ID 不安全。');
  if (!profileId) return projectId;
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(profileId)) throw new Error('会话档案 ID 不安全。');
  return `profile-${sha256Hex(JSON.stringify([projectId,profileId]))}`;
}

export function resolveDocumentSessionProfileKey(project: Pick<DocumentProject, 'id'|'activeSessionProfileId'|'sessionProfiles'>): string {
  const profileId=project.activeSessionProfileId;
  if (!profileId) return documentSessionProfileKey(project.id);
  if (!(project.sessionProfiles ?? []).some(profile=>profile.id===profileId)) throw new Error('当前选择的会话档案不属于此项目；请重新选择档案。');
  return documentSessionProfileKey(project.id,profileId);
}

export function isSafeSessionProfileText(value: string): boolean {
  return value.length > 0 && value.length <= 80 && !/(password|passwd|token|secret|cookie|authorization|密码|口令|令牌|验证码)/iu.test(value);
}
import type { DocumentProject } from './document-test-model.js';
import { sha256Hex } from './sha256.js';
