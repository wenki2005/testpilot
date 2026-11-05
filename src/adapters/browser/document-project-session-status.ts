import type { DocumentProjectSessionStatus, DocumentProject } from "../../domain/documents/shared/test-model.js";
import type { ActiveDocumentRunRegistry } from "../../application/runs/execution/active-document-run-registry.js";
import type { LoginHandoffState } from "./login-handoff.js";
import { resolveDocumentSessionProfileKey } from '../../domain/documents/projects/session-profile.js';
export interface DocumentProjectSessionStatusPorts {
    registry: Pick<ActiveDocumentRunRegistry, "isBrowserOccupied">;
    userDataDirectory(projectId: string): string;
    getLoginHandoff(projectId: string): LoginHandoffState | undefined;
    isLoginPage(page: {
        url(): string;
    }): Promise<boolean>;
    getExistingPage(userDataDir: string, options?: {
        browser?: 'chromium' | 'edge';
    }): Promise<{
        page: {
            isClosed(): boolean;
            url(): string;
        };
    } | undefined>;
    now(): string;
}
/** Observes the existing project Edge session without launching, closing or navigating it. */
export function createDocumentProjectSessionStatusAdapter(ports: DocumentProjectSessionStatusPorts) {
    return {
        async getStatus(project: Pick<DocumentProject, "id" | "targetUrl" | "sessionIdentityNote" | "sessionProfiles" | "activeSessionProfileId" | "executionConfig">, targetUrl = project.targetUrl): Promise<DocumentProjectSessionStatus> {
            const checkedAt = ports.now();
            const identityNote = project.sessionIdentityNote?.trim();
            const identity = identityNote ? { identityNote, identitySource: "user-confirmed" as const } : {};
            const handoff = ports.getLoginHandoff(project.id);
            const occupied = ports.registry.isBrowserOccupied(project.id);
            if (occupied)
                return {
                    state: "occupied", occupied: true,
                    manualLoginRequired: handoff ? handoff.status === "waiting_for_user" : null,
                    ...identity, checkedAt,
                    message: handoff?.status === "waiting_for_user"
                        ? "当前运行正在等待你在项目 Edge 窗口完成登录。"
                        : "项目 Edge 会话正被运行或步骤操作占用；为避免干扰，暂不检查页面。",
                };
            let profileKey: string;
            try {
                profileKey = resolveDocumentSessionProfileKey(project as DocumentProject);
            }
            catch {
                return { state: 'unknown', occupied: false, manualLoginRequired: null, ...identity, checkedAt, message: '当前选择的会话档案无效；请重新选择档案后检查。' };
            }
            const session = await ports.getExistingPage(ports.userDataDirectory(profileKey), project.executionConfig?.browser ? { browser: project.executionConfig.browser } : undefined).catch(() => undefined);
            if (!session || session.page.isClosed())
                return {
                    state: "unavailable", occupied: false, manualLoginRequired: null, ...identity, checkedAt,
                    message: "没有检测到可复用的项目 Edge 会话。运行时会连接或打开该项目的浏览器，并在需要时提示人工登录。",
                };
            try {
                if (await ports.isLoginPage(session.page))
                    return {
                        state: "connected", occupied: false, manualLoginRequired: true, ...identity, checkedAt,
                        message: "Edge 会话已连接，当前页面显示登录界面；需要你在这个窗口完成登录。",
                    };
                const actualOrigin = new URL(session.page.url()).origin;
                const expectedOrigin = new URL(targetUrl).origin;
                if (actualOrigin === expectedOrigin)
                    return {
                        state: "connected", occupied: false, manualLoginRequired: false, ...identity, checkedAt,
                        message: "Edge 会话已连接到当前目标网站，未检测到登录界面；这不代表目标系统的账号权限已验证。",
                    };
                return {
                    state: "unknown", occupied: false, manualLoginRequired: null, ...identity, checkedAt,
                    message: "Edge 会话已连接，但当前页面不是本轮目标网站；登录状态需要在运行时确认。",
                };
            }
            catch {
                return {
                    state: "unknown", occupied: false, manualLoginRequired: null, ...identity, checkedAt,
                    message: "Edge 会话已连接，但无法可靠判断当前页面是否需要登录。",
                };
            }
        },
    };
}
