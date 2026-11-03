import type { DocumentPageExplorationSessionPort } from '../ports/document-page-exploration.js';
import type { DocumentExplorationDecisionPort } from '../ports/document-exploration-decision.js';
import type { WebsiteMap, WebsiteMapProject, NavigationSnapshot, NavigationTarget } from '../../domain/document-website-map.js';
import { resolveDocumentSessionProfileKey } from '../../domain/document-session-profile.js';
import { summarizeWebsiteMapVerification } from '../../domain/document-website-map.js';
import { sha256Hex } from '../../domain/sha256.js';
import type { CaseNavigationCheck, DocumentCaseNavigationPort } from '../ports/document-case-navigation.js';
import { isCaseNavigationPageInScope } from '../../domain/document-navigation-scope.js';

export interface WebsiteMapRepository { save(map: WebsiteMap): Promise<void>; get(id: string): Promise<WebsiteMap | undefined>; latest(projectId: string): Promise<WebsiteMap | undefined> }
export function createDocumentWebsiteMapService(deps: {
  getProject(id: string): Promise<WebsiteMapProject | undefined>;
  exploration: DocumentPageExplorationSessionPort;
  decisions: DocumentExplorationDecisionPort;
  repository: WebsiteMapRepository;
  caseNavigation?: DocumentCaseNavigationPort;
  createId(): string; now(): string;
}) {
  const tasks = new Map<string, Promise<void>>();
  const starting = new Set<string>();
  const verifying = new Set<string>();
  const serviceStartedAt = deps.now();
  let bindingWrites = Promise.resolve();
  const identity = (snapshot: NavigationSnapshot) => JSON.stringify([snapshot.route, snapshot.headings, snapshot.targets.map(t => [t.kind, t.label, t.href]), snapshot.controls]);
  const targetKey = (target: NavigationTarget) => JSON.stringify(target);
  const errorText = (error: unknown) => error instanceof Error ? error.message.split(/\nBrowser logs:|\nCall log:/u)[0]!.slice(0, 1000) : '导航失败';
  async function explore(map: WebsiteMap, project: WebsiteMapProject) {
    const deadline = Date.now() + 180_000;
    let session: Awaited<ReturnType<DocumentPageExplorationSessionPort['open']>> | undefined;
    const persist = async () => { map.updatedAt = deps.now(); await deps.repository.save(map); };
    try {
      session = await deps.exploration.open(project);
      if (!session.navigationSnapshot || !session.activateNavigation || !session.resetNavigation) throw new Error('当前浏览器未实现导航探索能力。');
      let snapshot = await session.navigationSnapshot();
      const seen = new Map<string, string>();
      type Frame = { snapshot: NavigationSnapshot; id: string; path: NavigationTarget[]; attempted: Set<string> };
      const frames: Frame[] = [];
      async function restore(frame: Frame): Promise<NavigationSnapshot> {
        if (session!.restoreNavigation) {
          const restored = await session!.restoreNavigation(frame.snapshot.evidenceId); map.operations++;
          if (identity(restored) === identity(frame.snapshot)) return restored;
        }
        // Same-route menus and transient state still need the full observed path.
        let restored = await session!.resetNavigation!(); map.operations++;
        for (const target of frame.path) {
          const index = restored.targets.findIndex(t => targetKey(t) === targetKey(target));
          if (index < 0) throw new Error(`返回路径中的入口“${target.label}”已变化。`);
          restored = await session!.activateNavigation!(restored.evidenceId, index); map.operations++;
        }
        if (identity(restored) !== identity(frame.snapshot)) throw new Error('返回后页面状态已变化；旧导航路径未被盲目复用。');
        return restored;
      }
      function add(current: NavigationSnapshot, path: NavigationTarget[]): Frame {
        const id = deps.createId(); seen.set(identity(current), id);
        map.pages.push({ id, snapshot: current, path });
        const frame = { snapshot: current, id, path, attempted: new Set<string>() }; frames.push(frame); return frame;
      }
      add(snapshot, []);
      while (frames.length && map.operations < 60 && map.pages.length < 16 && Date.now() < deadline) {
        const frame = frames.at(-1)!;
        const remaining = snapshot.targets.map((target, index) => ({ target, index })).filter(({ target }) => !frame.attempted.has(targetKey(target)));
        if (!remaining.length) {
          frames.pop();
          if (!frames.length) break;
          const parent = frames.at(-1)!;
          snapshot = await restore(parent);
          parent.snapshot = snapshot;
          continue;
        }
        const decision = await deps.decisions.decide({ requirements: 'A01：探索当前账号可访问的主要页面和导航关系。提供的索引均为当前页面尚未尝试的入口。优先尚未访问的列表、详情、菜单和返回入口；仅选择提供的只读导航索引。没有其他相关入口时停止。已发现页面：' + map.pages.map(p => p.snapshot.headings.join(' / ') || p.snapshot.route).join('；').slice(0, 1800), visitedPages: [{ evidenceId: snapshot.evidenceId, route: snapshot.route, title: snapshot.title.slice(0, 2000), visibleText: snapshot.visibleText, links: remaining.map(({ target }) => ({ label: target.label, href: target.href ?? '[observed navigation control]' })) }] }, AbortSignal.timeout(Math.max(1, Math.min(12000, deadline - Date.now()))));
        // Model chooses priority, but a stop cannot silently discard visible safe branches.
        const unseenLabelIndex = remaining.findIndex(({ target }) => !map.edges.some(edge => edge.status === 'visited' && edge.target.label === target.label));
        const appliedIndex = decision.decision === 'stop' ? Math.max(0, unseenLabelIndex) : decision.index;
        map.decisionTrace = [...(map.decisionTrace ?? []), { pageId: frame.id, evidenceId: snapshot.evidenceId, decision: decision.decision, appliedIndex, ...(decision.decision === 'stop' ? { reason: decision.reason } : {}) }];
        const selected = remaining[appliedIndex];
        if (!selected) throw new Error('模型选择了快照外的导航索引。');
        frame.attempted.add(targetKey(selected.target));
        try {
          // Read APIs can finish while the model is choosing an entry. Re-find
          // the same observed target by identity; never reuse its old index.
          const refreshed = await session.navigationSnapshot();
          if(refreshed.route!==snapshot.route)throw Error('模型决策期间页面地址发生变化，已停止旧页面导航。');
          const currentIndex=refreshed.targets.findIndex(target=>targetKey(target)===targetKey(selected.target));
          if(currentIndex<0)throw Error(`当前页面已找不到刚选择的入口“${selected.target.label}”，未使用过期索引。`);
          snapshot=refreshed;frame.snapshot=refreshed;
          const stored=map.pages.find(p=>p.id===frame.id);if(stored)stored.snapshot=refreshed;
          seen.set(identity(refreshed),frame.id);
          const next = await session.activateNavigation(refreshed.evidenceId, currentIndex); map.operations++;
          const known = seen.get(identity(next));
          const destination = known ?? deps.createId();
          map.edges.push({ from: frame.id, to: destination, target: selected.target, status: 'visited' });
          if (!known) {
            const child = add(next, [...frame.path, selected.target]);
            map.edges.at(-1)!.to = child.id;
            snapshot = next;
          } else {
            // Restore the source before trying sibling controls, including SPA state.
            snapshot = await restore(frame);
          }
        } catch (error) {
          map.edges.push({ from: frame.id, target: selected.target, status: 'blocked', reason: errorText(error) });
          // Unknown page state cannot be used to try another source-page index.
          throw error;
        }
        await persist();
      }
      if (frames.length) map.notices.push('达到本轮页面、操作或三分钟时间预算，仍有未探索分支。');
      map.state = map.notices.length || map.edges.some(e => e.status === 'blocked') ? 'partial' : 'completed';
    } catch (error) {
      map.state = map.pages.length ? 'partial' : 'blocked';
      map.notices.push(errorText(error));
    } finally {
      try { await session?.close(); }
      catch { map.state = 'partial'; map.notices.push('浏览器探索会话释放异常，请检查当前会话状态。'); }
      try { await persist(); } finally { tasks.delete(map.projectId); }
    }
  }
  return {
    async resolveCase(projectId: string, caseId: string) {
      const project=await deps.getProject(projectId);
      const item=project?.cases?.find(c=>c.id===caseId);
      if(!project||!item)throw Error('用例不属于当前项目。');
      const evidence=await this.evidenceForCase(project,item);
      if(!evidence) {
        const map=await deps.repository.latest(projectId);
        return {caseId,status:'unresolved' as const,reason:map?.caseBindings?.filter(b=>b.caseId===caseId).at(-1)?.reason??'当前地图没有可确认的用例页面。'};
      }
      const result=await this.verifyPage(projectId,evidence.pageId);
      const map=await deps.repository.latest(projectId);
      return {caseId,status:'verified' as const,mapId:evidence.mapId,pageId:evidence.pageId,route:evidence.route,path:evidence.path,reason:map?.caseBindings?.filter(b=>b.caseId===caseId).at(-1)?.reason??'使用已有明确页面路径。',checkedAt:result.checkedAt};
    },
    async verifyPage(projectId: string, pageId: string) {
      if (tasks.has(projectId) || starting.has(projectId) || verifying.has(projectId)) throw new Error('当前探索或路径复验尚未结束，请稍后验证路径。');
      const project = await deps.getProject(projectId);
      const map = await deps.repository.latest(projectId);
      const destination = map?.pages.find(p => p.id === pageId);
      if (!project || !map || !destination || map.targetUrl !== project.targetUrl || map.profileKey !== resolveDocumentSessionProfileKey(project)) throw new Error('页面地图不属于当前目标或账号，请重新探索。');
      verifying.add(projectId);
      let session: Awaited<ReturnType<DocumentPageExplorationSessionPort['open']>> | undefined;
      try {
        session = await deps.exploration.open(project);
        if (!session.navigationSnapshot || !session.activateNavigation) throw new Error('当前浏览器不支持导航路径复验。');
        let current = await session.navigationSnapshot();
        for (const target of destination.path) {
          const index = current.targets.findIndex(t => targetKey(t) === targetKey(target));
          if (index < 0) throw new Error(`当前页面已找不到入口“${target.label}”，保存路径需要重新探索。`);
          current = await session.activateNavigation(current.evidenceId, index);
        }
        if (current.route !== destination.snapshot.route || JSON.stringify(current.headings) !== JSON.stringify(destination.snapshot.headings)) throw new Error('路径执行后没有到达原目标页面，不能认为复用成功。');
        // A successful navigation with failed cleanup is not a reusable path.
        await session.close(); session=undefined;
        const result = { pageId, checkedAt: deps.now(), status: 'verified' as const };
        map.verifications = [...(map.verifications ?? []), result].slice(-100); await deps.repository.save(map);
        return { ...result, snapshot: current };
      } catch (error) {
        map.verifications = [...(map.verifications ?? []), { pageId, checkedAt: deps.now(), status: 'blocked' as const, reason: errorText(error) }].slice(-100); await deps.repository.save(map); throw error;
      } finally { try { await session?.close(); } finally { verifying.delete(projectId); } }
    },
    async start(projectId: string) {
      if (tasks.has(projectId) || starting.has(projectId) || verifying.has(projectId)) throw new Error('该项目已在探索或复验中，请查看当前进度。');
      starting.add(projectId);
      try {
      const project = await deps.getProject(projectId);
      if (!project) throw new Error('项目不存在。');
      const map: WebsiteMap = { id: deps.createId(), projectId, targetUrl: project.targetUrl, profileKey: resolveDocumentSessionProfileKey(project), createdAt: deps.now(), updatedAt: deps.now(), state: 'running', pages: [], edges: [], notices: [], operations: 0 };
      await deps.repository.save(map);
      const task = explore(map, structuredClone(project)); tasks.set(projectId, task);
      void task.catch(() => tasks.delete(projectId));
      return structuredClone(map);
      } finally { starting.delete(projectId); }
    },
    async latest(projectId: string) {
      const map = await deps.repository.latest(projectId);
      if (map?.state === 'running' && !tasks.has(projectId)) return { ...map, state: 'partial' as const, notices: [...map.notices, '服务已重启；本轮探索已中断，可重新探索。'] };
      return map ? { ...map, runtimeVerification: summarizeWebsiteMapVerification(map, serviceStartedAt) } : map;
    },
    async evidenceForCase(project: WebsiteMapProject, item: CaseNavigationCheck) {
      const map = await deps.repository.latest(project.id);
      if (!map || !['completed', 'partial'].includes(map.state) || map.targetUrl !== project.targetUrl || map.profileKey !== resolveDocumentSessionProfileKey(project)) return undefined;
      const recordIds = [...new Set(`${item.title} ${item.expected??''} ${(item.testData??[]).join(' ')}`.match(/(?<!\d)20\d{10}(?!\d)/gu)??[])];
      const candidates = map.pages.filter(p => isCaseNavigationPageInScope(item,p) && recordIds.every(id => `${p.snapshot.route} ${p.snapshot.visibleText.join(' ')}`.includes(id)));
      // An explicit entry is authoritative. Automatic matching must be unambiguous.
      const matches = candidates.filter(p => item.entryPath ? p.snapshot.route === item.entryPath : p.snapshot.headings.some(heading => heading.length >= 4 && `${item.source} ${item.title}`.includes(heading)));
      let page = matches.length === 1 ? matches[0] : undefined;
      if (!page && !item.entryPath && deps.caseNavigation) {
        const caseDigest = sha256Hex(JSON.stringify([item.title,item.source,item.expected??'',item.preconditions??[],item.testData??[]]));
        const cached = map.caseBindings?.find(binding => binding.caseDigest === caseDigest);
        if (cached && (cached.pageId===null || candidates.some(p=>p.id===cached.pageId))) page = candidates.find(p => p.id === cached.pageId);
        else {
          const selection = candidates.length ? await deps.caseNavigation.select({ check: item, pages: candidates.map(p => ({...p,pathLabels:p.path.map(t=>t.label)})) }) : { pageId:null,reason:recordIds.length?'已发现页面中没有指定申请记录，不能选择其他记录替代。':'当前地图没有与本例业务模块及页面类型相符的页面；不能用其它模块的列表或详情替代。' };
          page = candidates.find(p => p.id === selection.pageId);
          if (selection.pageId && !page) throw Error('页面匹配选择了当前地图之外的页面。');
          const binding = { ...(item.id ? {caseId:item.id}:{}),caseDigest,pageId:page?.id??null,reason:selection.reason,...(selection.caseQuote ? {caseQuote:selection.caseQuote}:{}),...(selection.pageQuote ? {pageQuote:selection.pageQuote}:{}),createdAt:deps.now() };
          const save = bindingWrites.then(async()=>{
            const latest=await deps.repository.latest(project.id);
            if(latest?.id!==map.id)return;
            latest.caseBindings=[...(latest.caseBindings??[]).filter(b=>b.caseDigest!==caseDigest),binding].slice(-250);
            await deps.repository.save(latest);
          });
          bindingWrites=save.catch(()=>undefined);await save;
        }
      }
      if(!page)return undefined;
      return { mapId: map.id, pageId: page.id, route: page.snapshot.route, path: page.path, snapshot: page.snapshot };
    },
  };
}
