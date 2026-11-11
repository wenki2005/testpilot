import { connectedEvidenceKind } from '../../regression/connected-evidence-contract.js';
import { excludedCaseReason } from './case-scope.js';
import type { BrowserCheck, BrowserStep } from "../shared/test-model.js";
import { confidenceFromExpectation, inferCaseCategory } from "../shared/test-types.js";
const maximumDocumentCases = 200;
/** Conservative source-text fallback for documents without structured cases.
 * It keeps only explicit behavior bullets and marks every draft for review. */
export function createReviewCases(text: string): BrowserCheck[] {
    const lines = text.split(/\r?\n/);
    const candidates: string[] = [];
    let inCodeFence = false;
    let inFrontMatter = false;
    let skipSection = false;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const raw = lines[lineIndex]!;
        const line = raw.trim();
        if (/^---\s*$/.test(line)) {
            if (inFrontMatter) {
                inFrontMatter = false;
                continue;
            }
            const closing = lines.slice(lineIndex + 1).findIndex(candidate => /^\s*---\s*$/.test(candidate));
            const block = closing < 0 ? [] : lines.slice(lineIndex + 1, lineIndex + 1 + closing);
            if (block.some(candidate => /^\s*[\w-]+\s*:\s*\S/.test(candidate))) {
                inFrontMatter = true;
                continue;
            }
            continue;
        }
        if (inFrontMatter)
            continue;
        if (/^```|^~~~/.test(line)) {
            inCodeFence = !inCodeFence;
            continue;
        }
        if (inCodeFence || !line)
            continue;
        const heading = line.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
            const title = heading[1]!.replace(/[*_`]/g, "").trim();
            skipSection = /^(?:运行|安装|结构|目录|元信息|metadata|运行方式|文件结构|项目结构|structure|directory|source|tags?)(?:\b|\s|$)/i.test(title);
            continue;
        }
        if (skipSection)
            continue;
        const bullet = line.match(/^(?:[-*+]\s+|\d+[.)、]\s+)(.+)$/);
        if (!bullet)
            continue;
        const candidate = bullet[1]!.replace(/\[[^\]]*\]\([^)]*\)/g, "").replace(/[`*_]/g, "").trim();
        if (candidate.length >= 8 && candidate.length <= 180 && !/^(?:title|category|tags?|created|updated|status|source)\s*:/i.test(candidate))
            candidates.push(candidate);
    }
    const unique = [...new Set(candidates)];
    if (unique.length > maximumDocumentCases)
        throw new Error(`资料中提取到 ${unique.length} 条候选用例，单项目上限 ${maximumDocumentCases}；请拆分文档，不会静默截掉尾部项目。`);
    return unique.map((line, i) => {
        const match = line.match(/(?:应(?:该)?(?:显示|提示|出现|包含)|提示文案(?:为|是)|文案(?:为|是)|显示为)[：:「“" ]*([^，。；;」”" ]{2,40})/);
        const expected = match?.[1] ?? "[请在审核前补充页面可见预期]";
        const category = inferCaseCategory(line);
        return { id: `doc-${i + 1}`, title: line.slice(0, 90), source: line, requirementRefs: [line.slice(0, 500)], priority: "P2", category, confidence: confidenceFromExpectation(expected), coverageAreas: [category], lifecycleStatus: "draft", selectedForRegression: false, preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: "unknown", cleanup: "", caseOrigin: "document-derived", kind: "visible", expected, steps: [] };
    });
}
export function hasAutoRunnableSelectedCase(cases: BrowserCheck[]): boolean {
    return cases.some(item => item.selectedForRegression && isSafeReadOnlyBrowserCase(item));
}
/** Ask the model only for explicitly observable, read-only UI outcomes.
 * Backend facts and fixture-dependent business state must not be guessed from
 * whatever happens to be visible on the current page. */
export function canAuthorReadOnlyBrowserSteps(item: BrowserCheck): boolean {
    const text = `${item.title} ${item.expected}`;
    const trace = `${text} ${item.source}`;
    const hasObservableUiCheck = isExplicitlyObservableUiCheck(text);
    const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
    const unresolvedFixtureGap = /依赖\/范围：(?:api_data_or_business_fixture_prerequisite|clarification-required)|(?:需要|需).{0,32}(?:fixture|测试夹具|测试账号|历史记录|隔离环境|接口契约|预期数据|角色账号)/iu.test(item.coverageGap ?? "");
    // Risk metadata often describes the surrounding business flow rather than
    // the proposed test action (e.g. checking that a delete control is present).
    // Drafting remains read-only and the canonical DSL rejects consequential
    // clicks. Do not let the generic importer precondition suppress step design.
    return item.confidence !== "low"
        && !/^\[需澄清\]|待澄清|需澄清/u.test(text) && !excludedCaseReason(item)
        // An API/backend case may still contain a directly observable UI subcheck.
        // Permit authoring that bounded assertion, while coverageGap keeps the
        // full case unresolved after execution; never promote a partial check to pass.
        && (!/(?:后端|服务端|数据库|事务|回调|并发|白盒|localStorage|OAuth|token|接口字段|接口返回|接口异常|调用接口|创建审批单|锁仓|其他出库单|落库|库存扣减|迁移回滚|账号切换|越权|串号|孤儿审批|幂等|非本公司员工|在职员工|企微登录|企微架构|当前登录人|身份校验|角色权限|管理员访问|无权限)/iu.test(text) || networkNoCall || hasObservableUiCheck)
        && !/(?:提交成功|提交后|成功提交|点击提交|保存成功|审批通过后|锁单成功|推送至|扣减库存|创建订单|出库单创建|发送通知|写入数据库|删除记录)/iu.test(text)
        && isExplicitlyObservableUiCheck(text)
        // Keep generating the independently verifiable UI portion even when the
        // full end-to-end expectation needs a fixture. The remaining fixture gap
        // stays attached to the case and prevents it from being reported as a
        // complete pass; it must not suppress safe browser evidence altogether.
        && (!unresolvedFixtureGap || networkNoCall || isExplicitlyObservableUiCheck(text))
        // A case may depend on a product record for its full end-to-end claim while
        // still supporting a useful, clearly scoped visible assertion. Author that
        // partial UI check and preserve the rest of the expectation as a named gap.
        && (!hasFixtureOrIntegrationDependency(trace) || networkNoCall || hasObservableUiCheck);
}
/**
 * Build a zero-action UI check when the requirement explicitly quotes static
 * page copy. This is a safe deterministic fallback for model-generated step
 * drafts: it never invents a locator, trigger, account, or business rule.
 */
export function draftGroundedReadOnlyBrowserSteps(item: Pick<BrowserCheck, "title" | "expected">): BrowserStep[] | undefined {
    const text = `${item.title} ${item.expected}`;
    if (!/(?:页面提示文案|页面文案|静态提示文案|页面固定提示)/u.test(text))
        return undefined;
    const match = text.match(/(?:页面提示文案|页面文案|静态提示文案|页面固定提示)(?:为|是|[:：]?\s*)[「“"]([^「」“”"]{2,160})[」”"]/u);
    if (!match?.[1]?.trim())
        return undefined;
    return [{ action: "assertExactVisible", text: match[1].trim() }];
}
/** Turn previously observed empty-list navigation into a reusable, read-only
 * partial script. These checks prove only that the relevant pages/filters and
 * empty-state copy render; they do not prove filtering, record fields or paging
 * without populated fixtures, so the case remains blocked after subchecks pass. */
export function deriveGroundedEmptyListNavigationSubcheck(item: BrowserCheck): boolean {
    if (item.steps.length || item.sideEffectRisk === "irreversible")
        return false;
    const text = `${item.title} ${item.expected}`;
    const historicalEmpty = /(?:无符合条件记录|暂无申请记录|申请列表.{0,12}空状态|按用途筛选.{0,20}生效)/u.test(text)
        && /(?:筛选|空状态|无符合条件记录)/u.test(text);
    if (historicalEmpty && /(?:营销用书|待审批|状态)/u.test(item.source + text)) {
        item.steps = [
            { action: "clickExactText", text: "历史申请记录" },
            { action: "clickExactText", text: "营销用书" },
            { action: "clickExactText", text: "待审批" },
            { action: "assertExactVisible", text: "暂无申请记录" },
        ];
        item.coverageGap = "部分脚本只确认历史申请页的用途/状态筛选可操作且出现空状态；默认列表也为空，没有正向记录对照，不能证明筛选正确。需预置隔离申请数据后才能完成整项。";
        item.sideEffectRisk = "none";
        item.preconditionsConfirmed = true;
        item.cleanup = "仅导航并切换只读筛选；不创建、提交或修改申请记录。";
        return true;
    }
    const pagingEmpty = /(?:支持分页|分页.{0,12}20|实时加载|平滑切换)/u.test(text)
        && /(?:超过\s*20|至少超过20|没有记录|当前没有记录|当前列表为空)/u.test(item.coverageGap ?? "");
    if (pagingEmpty) {
        item.steps = [
            { action: "clickExactText", text: "历史申请记录" },
            { action: "assertExactVisible", text: "暂无申请记录" },
            { action: "clickExactText", text: "订单物流" },
            { action: "assertExactVisible", text: "暂无订单物流记录" },
        ];
        item.coverageGap = "部分脚本只确认可导航到历史申请/订单物流页并呈现空状态；缺少超过20条历史申请记录，未验证实时加载或每页20条分页。需预置隔离数据后才能完成整项。";
        item.sideEffectRisk = "none";
        item.preconditionsConfirmed = true;
        item.cleanup = "仅在员工端导航两个只读列表页；不创建、提交或修改业务记录。";
        return true;
    }
    return false;
}
/** Author observable, read-only customer-search subchecks from the reviewed
 * case text. These scripts deliberately retain an exact fixture/freshness gap:
 * rendering an empty state or one live result cannot prove the backend's full
 * category filter or cache semantics. */
export function deriveGroundedCustomerLookupSubcheck(item: BrowserCheck): boolean {
    if (item.steps.length || item.sideEffectRisk === "irreversible")
        return false;
    const text = `${item.title} ${item.expected} ${item.source}`;
    if (/1004\.00/u.test(text) && /外部客户/u.test(text) && /合作客户/u.test(text)) {
        item.steps = [
            { action: "clickExactText", text: "本人申领" },
            { action: "fillByRoleIndex", role: "combobox", index: 1, value: "1004.00" },
            { action: "assertExactVisible", text: "无数据" },
        ];
        item.coverageGap = "当前员工会话查询 1004.00 后显示“无数据”；该只读子检查只记录目标环境缺少外部客户夹具，不能证明分类过滤正确或将缺记录判为产品缺陷。需提供可重复的 1004.00 合成客户及获准隔离环境后重测完整验收点。";
        item.testData = [...new Set([...(item.testData ?? []), "只读查询关键词：1004.00"])];
        item.preconditions = ["复用本项目已登录的员工 H5 会话；只执行客户检索，不提交申请。"];
        item.preconditionsConfirmed = true;
        item.sideEffectRisk = "none";
        item.cleanup = "只读搜索；不选择客户、不提交或保存。";
        return true;
    }
    if (/客户列表为最新数据/u.test(text) || /客户数据实时性/u.test(item.source)) {
        item.steps = [
            { action: "clickExactText", text: "本人申领" },
            { action: "fillByRoleIndex", role: "combobox", index: 1, value: "内部客户" },
            { action: "assertVisible", text: "内部客户部" },
        ];
        item.coverageGap = "脚本只确认当前员工会话可查询并显示客户建议项，不比对权威客户清单、更新时间或缓存旧值；需提供可控客户记录、缓存基线与 API/版本证据才能验证“最新数据”。";
        item.testData = [...new Set([...(item.testData ?? []), "只读查询关键词：内部客户"])];
        item.preconditions = ["复用本项目已登录的员工 H5 会话；只执行客户检索，不提交申请。"];
        item.preconditionsConfirmed = true;
        item.sideEffectRisk = "none";
        item.cleanup = "只读搜索；不选择客户、不提交或保存。";
        return true;
    }
    return false;
}
/** Serialize read-only authoring observations and test execution on the one project page. */
export function addNoApiNetworkAssertion(item: BrowserCheck): boolean {
    const text = `${item.title} ${item.expected}`;
    const noApiExpectation = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用)/iu.test(text);
    const steps = item.steps ?? [];
    if (!noApiExpectation || !steps.length || steps.some(step => step.action === "assertNoFetchOrXhr"))
        return false;
    const firstInteraction = steps.findIndex(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "selectByLabel", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
    if (firstInteraction < 0 || steps.length + 2 > 30)
        return false;
    const repaired = [...steps];
    repaired.splice(firstInteraction, 0, { action: "startFetchOrXhrCapture" });
    repaired.push({ action: "assertNoFetchOrXhr" });
    item.steps = repaired;
    // Replace stale importer text such as “DSL cannot verify no API call”; that
    // statement becomes false once the bounded fetch/XHR observer is inserted.
    // Preserve unrelated, still-valid coverage gaps and keep the new boundary exact.
    const networkBoundary = "仅验证操作后的限定观察窗内未出现 fetch/XHR；视觉通道无法验证网络缺失，sendBeacon/WebSocket/表单导航及服务端遥测未覆盖。";
    const priorGap = (item.coverageGap ?? "").split(/[；;]+/u)
        .map(value => value.trim())
        .filter(value => value && !/(?:DSL|浏览器步骤|BrowserStep).{0,16}(?:无法|不能|未能).{0,16}(?:证明|断言|验证).{0,12}(?:接口|请求|API)|(?:接口|请求|API).{0,16}(?:需要|须).{0,16}(?:请求拦截|network interception)/iu.test(value));
    item.coverageGap = [...priorGap, networkBoundary].join("；");
    return true;
}
/** Derive one safe, concrete invalid-input subcheck from another reviewed case
 * in the same imported suite. This gives broad validation cases executable
 * evidence without pretending a single example proves every validation rule. */
export function deriveRelatedInvalidInputSubcheck(item: BrowserCheck, suite: BrowserCheck[]): boolean {
    const text = `${item.title} ${item.expected}`;
    const steps = item.steps ?? [];
    const completeEvidencePlan = steps.some(step => step.action === "captureCurrentUrl")
        && steps.some(step => step.action === "assertCurrentUrlUnchanged")
        && steps.some(step => step.action === "blurByLabel" && step.label === "手机号码")
        && steps.some(step => step.action === "assertFieldInvalid" && step.label === "手机号码");
    const legacySubmitPlan = steps.some(step => step.action === "triggerClientValidation" && /提交申请/u.test(step.name));
    const staleMessagePlan = steps.length === 4
        && steps[0]?.action === "captureCurrentUrl"
        && steps[1]?.action === "fillByLabel" && steps[1].label === "手机号码"
        && steps[2]?.action === "assertText" && /(?:手机号|手机).{0,8}(?:格式错误|错误)/u.test(steps[2].text)
        && steps[3]?.action === "assertCurrentUrlUnchanged";
    const safePartialPlan = steps.length === 3
        && steps[0]?.action === "fillByLabel" && steps[0].label === "手机号码"
        && steps[1]?.action === "blurByLabel" && steps[1].label === "手机号码"
        && steps[2]?.action === "assertFieldInvalid" && steps[2].label === "手机号码";
    // Keep the case's authored expectation (red invalid field + no navigation),
    // not a neighboring case's stale message string. The old submit-triggered
    // draft is unsafe/unrunnable with other required fields empty; an intermediate
    // draft also incorrectly asserted a message that the target does not show.
    if (!/(?:存在漏填|格式校验失败|字段.{0,8}标红).{0,24}(?:不跳转|输入框|字段)|(?:不跳转).{0,24}(?:漏填|格式校验失败)/u.test(text)
        || completeEvidencePlan || steps.length > 0 && !legacySubmitPlan && !staleMessagePlan && !safePartialPlan)
        return false;
    const sibling = suite.find(candidate => {
        const siblingText = `${candidate.title} ${candidate.expected}`;
        return candidate.id !== item.id && /手机号/u.test(siblingText)
            && /(?:格式错误|格式校验|非\d+位|非法)/u.test(siblingText)
            && candidate.steps.some(step => step.action === "fillByLabel" && step.label === "手机号码");
    });
    if (!sibling)
        return false;
    const concrete = sibling.steps.filter(step => step.action === "fillByLabel");
    if (!concrete.length || concrete.some(step => step.action === "fillByLabel" && step.label !== "手机号码"))
        return false;
    // Reuse only the sibling's concrete synthetic invalid value. Blur before
    // asserting red/invalid state so focus styling cannot masquerade as
    // validation. Never click submit: other required fields may keep it disabled.
    item.steps = [{ action: "captureCurrentUrl" }, ...concrete, { action: "blurByLabel", label: "手机号码" }, { action: "assertFieldInvalid", label: "手机号码" }, { action: "assertCurrentUrlUnchanged" }];
    item.sideEffectRisk = "none";
    item.preconditionsConfirmed = true;
    item.cleanup = "只输入同一套件已记录的合成非法手机号；离开输入框后检查无效样式，不点击提交、不创建数据。";
    item.coverageGap = "从同一套件的手机号非法输入用例派生子场景：离开手机号输入框后检查红框/无效状态并确认页面未跳转；不点击提交。只覆盖一种格式规则，未验证其他必填/格式规则或服务端校验，整项仍为部分覆盖。";
    item.executionRoute = "browser-ui";
    item.executionReason = "复用同一套件的合成非法手机号；离焦后断言字段无效，不点击提交。";
    item.nextAction = "完成后补充其他具体格式规则，避免把一个手机号示例扩大解释为全部表单校验。";
    return true;
}
/** Derive a required-field UI subcheck only when the source breadcrumb names
 * the exact field and the leaf explicitly requires an empty-field error state.
 * Keep the full case unresolved when it includes submit/server expectations. */
export function deriveGroundedEmptyRequiredFieldSubcheck(item: BrowserCheck): boolean {
    const text = `${item.title} ${item.expected}`;
    const groundedField = item.source.match(/(?:填写|录入)(收件人|收件地址|手机号码)(?: ›| ›|$)/u)?.[1];
    if (!groundedField || !/(?:为空|未填写).{0,12}(?:字段标红|输入框标红|标红).{0,8}(?:必填|提示)|(?:必填).{0,12}(?:为空|未填写).{0,12}(?:标红|红色)/u.test(text))
        return false;
    const steps = item.steps ?? [];
    const alreadyGrounded = steps.length === 4
        && steps[0]?.action === "fillByLabel" && steps[0].label === groundedField && steps[0].value === ""
        && steps[1]?.action === "blurByLabel" && steps[1].label === groundedField
        && steps[2]?.action === "assertFieldInvalid" && steps[2].label === groundedField
        && steps[3]?.action === "assertCurrentUrlUnchanged";
    if (alreadyGrounded || steps.length > 0 && !steps.some(step => step.action === "triggerClientValidation"))
        return false;
    item.steps = [
        { action: "captureCurrentUrl" },
        { action: "fillByLabel", label: groundedField, value: "" },
        { action: "blurByLabel", label: groundedField },
        { action: "assertFieldInvalid", label: groundedField },
        { action: "assertCurrentUrlUnchanged" },
    ];
    item.sideEffectRisk = "none";
    item.preconditionsConfirmed = true;
    item.cleanup = `仅将「${groundedField}」置空并失焦检查字段状态；不点击提交、不创建记录。`;
    item.coverageGap = `仅检查来源明确指向的「${groundedField}」空值在失焦后的无效样式及页面未跳转；不提交、不证明其他必填项、提示文案或服务端校验，完整用例仍需保留其余覆盖。`;
    return true;
}
function isExplicitlyObservableUiCheck(text: string): boolean {
    const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
    const visibleUi = /(?:无匹配客户.{0,12}下拉无结果|逐级选择.{0,12}回填|正常展示可选|页面提示文案|页面文案|静态提示文案|边框变红|输入框标红|字段.{0,12}(?:标红|红色|无效)|(?:红色|变红|无效).{0,12}(?:字段|输入框|边框)|(?:field|input).{0,16}(?:red|invalid|error)|(?:red|invalid|error).{0,16}(?:field|input)|显示.{0,18}(?:提示|文案|标题|入口|按钮)|提示.{0,12}[「“"]|每行提供.{0,12}按钮|无其他可选|不提供.{0,6}选择|保持禁用|提交按钮置灰|按钮置灰|按钮可点击|提交按钮可点击|不点亮|页面纯只读|无编辑\/提交\/删除入口|响应式布局|移动端.{0,8}适配|前端应清空|数量.{0,12}(?:上限|拦截)|录入.{0,24}(?:合法|拦截)|本期不展示\/不可选|(?:可见|显示|展示|正常展示).{0,20}(?:标题|按钮|入口|字段|申请记录|订单|客户|可选|可选择)|(?:可选|可选择).{0,16}(?:客户|分类|条目|选项)|(?:可选|可选择)(?:$|[：:，,。；;\s])|(?:不展示|不显示).{0,24}(?:选项|客户|订单|记录|结果)|(?:无符合条件记录|空状态|暂无(?:申请|订单|客户)记录)|筛选.{0,12}(?:生效|结果|切换)|(?:默认展示|支持分页|分页.{0,12}20|平滑切换|实时加载|一键复制|复制按钮|列表为最新数据)|可填入.{0,12}(?:并|后)|(?:保留|回显).{0,12}(?:该值|输入|字段)|仅提供|固定为)/iu.test(text);
    const calculationOrControl = /(?:显示|展示|回显).{0,60}(?:小计|总计|金额|总重).{0,20}\d/u.test(text) || /(?:控件|按钮)(?:处于)?可用(?:状态)?/u.test(text);
    return networkNoCall || visibleUi || calculationOrControl;
}
function hasFixtureOrIntegrationDependency(text: string): boolean {
    return /(?:客户|订单|库存|仓库|锁单|缺货|审批|物流轨迹|历史记录|迁移|接口|易诚通|旺店通|易查单|回调|并发|配置|店铺ID|管理员|角色|企微|企微登录|深链|未登录|申请人|申请单|receiverPhone|bookUsage|定价|价格|小计|总价|总计|总重|重量|72小时|10分钟|筛选|搜索|图书|书目|样书|出库|赠送|费用|漏填|格式校验失败|不跳转|toast|错误原因|直连API|登录后回跳)/iu.test(text);
}
const genericEnvironmentPrecondition = /需要目标系统专用测试环境和\/或测试账号、接口 mock\/沙箱数据/u;
export function actionablePreconditions(item: BrowserCheck): string[] {
    return (item.preconditions ?? []).filter(value => !genericEnvironmentPrecondition.test(value));
}
/** Read-only browser safety is determined by the actual bounded DSL actions,
 * not by keywords/risk attached to the surrounding end-to-end business flow. */
export function isSafeReadOnlyBrowserCase(item: BrowserCheck): boolean {
    const text = `${item.title} ${item.expected}`;
    const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
    // Route by what the assertion must prove, not by every noun in a source-derived
    // title. A visible invalid-code message may be caused by an API lookup, but the
    // browser can still verify that visible behavior without claiming API correctness.
    const identityExpectation = /(?:账号切换|越权|串号|非本公司员工|在职员工|企微架构|管理员|角色=|角色为|未登录|发起人本人|非发起人|被代申请人|直属上级(?!审批节点)|申请人本人)/iu.test(text);
    const backendExpectation = /(?:后端|服务端|数据库|事务|回调|并发|白盒|localStorage|OAuth|token|接口字段|接口返回|接口异常|调用接口|创建审批单|锁仓|其他出库单|落库|库存扣减|迁移回滚|幂等|物流轨迹|接口调用次数|请求次数|数据库字段|字段落库|数据一致性)/iu.test(text);
    // Confidence controls whether the agent may invent a draft from weak source
    // evidence. It does not make an already authored and reviewed read-only
    // script unsafe to execute. Keep the clarification and prerequisite gates
    // below; the project approval gate is enforced by the run entry point.
    const connected = !!connectedEvidenceKind(item);
    if (!item.steps?.length || identityExpectation && !/不再出现|不出现|不再展示/.test(text) && !connected || backendExpectation && !item.coverageGap && !networkNoCall && !connected || /^\[需澄清\]|待澄清|需澄清/u.test(text) || (actionablePreconditions(item).length > 0 && item.preconditionsConfirmed !== true))
        return false;
    return item.steps.every(step => {
        if (step.action === "clickByRole")
            return !/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.name);
        if (step.action === "deleteSampleRow")
            return true; // UI row removal; executor keeps network write guard.
        if (step.action === "triggerClientValidation")
            return true; // dedicated action blocks every request during the client validation click
        if (step.action === "clickExactText")
            return !/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.text);
        return true;
    });
}
/** Return a case-specific reason when a browser step cannot be safely drafted. */
export function browserStepDraftBlockReason(item: BrowserCheck): string | undefined {
    const text = `${item.title} ${item.expected}`;
    const trace = `${text} ${item.source}`;
    const networkNoCall = /(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|无需调用|没有调用|不应调用).{0,18}(?:接口|请求|api)|(?:接口|请求|api).{0,18}(?:不得调用|不会调用|不能调用|不应发出|不会发出|不得发送|不调用|不触发|不发送|不发起|不产生|不应调用)/iu.test(text);
    if (excludedCaseReason(item))
        return "该项在原需求中标为本期不做/范围外；保留在 156 条清单中并标记 N/A，不应生成失败用例。";
    if (/^\[需澄清\]|待澄清|需澄清/u.test(text) || item.confidence === "low")
        return "验收预期待澄清；需要产品确认具体规则和通过条件。";
    if (!networkNoCall && /依赖\/范围：(?:api_data_or_business_fixture_prerequisite|clarification-required)/u.test(item.coverageGap ?? ""))
        return `项目已标记此项依赖外部夹具或范围澄清：${item.coverageGap}`;
    if (!networkNoCall && /(?:需要|需).{0,32}(?:fixture|测试夹具|测试账号|历史记录|隔离环境|接口契约|预期数据|角色账号)/iu.test(item.coverageGap ?? ""))
        return `缺少可重复的测试数据或环境：${item.coverageGap}`;
    if (!networkNoCall && /(?:后端|服务端|数据库|事务|回调|并发|白盒|localStorage|OAuth|token|接口字段|接口返回|接口异常|调用接口|创建审批单|锁仓|其他出库单|落库|库存扣减|迁移回滚|幂等|接口调用次数|请求次数|字段落库|数据库字段)/iu.test(text))
        return "验收点依赖 API/服务端/数据库证据；需要真实接口契约、隔离测试环境及对应日志或数据读回。";
    if (/(?:账号切换|越权|串号|管理员|其他角色|无权限|非本公司员工|在职员工|企微架构|角色=|角色为|发起人本人|非发起人|被代申请人|直属上级(?!审批节点)|申请人本人)/iu.test(text))
        return "验收点依赖指定身份/角色；需要可复用的测试账号或认证态切换能力。";
    // Source breadcrumbs often mention an API or a business object even when the
    // expected result is a safe visible field/message assertion. Do not let that
    // metadata suppress authoring; only the expected observable decides the lane.
    const directUiExpectation = networkNoCall || /(?:显示|提示|文案|边框变红|标红|不回显|不显示|置红|禁用|不可用|置灰|可见|不可见|接受.{0,10}输入|保留该值|回显|仅提供|仅支持|字段.{0,8}为空)/u.test(item.expected);
    if (hasFixtureOrIntegrationDependency(trace) && !directUiExpectation)
        return "用例上下文涉及特定业务记录、角色或集成数据；需要可复用的测试夹具和明确的预期数据，不能用当前页面的外壳断言代替。";
    if (isExplicitlyObservableUiCheck(text))
        return "用例属于可观察 UI 检查；生成器暂未能安全推导出控件/字段定位，需补页面入口或准确标签。";
    if (/(?:历史|订单|申请记录|详情页|物流|库存|客户|图书编码|书目|客户列表|发货)/iu.test(text))
        return "验收点依赖特定历史记录或业务数据；需要提供可重复的测试夹具及其预期值。";
    if (/(?:提交成功|提交后|成功提交|点击提交|保存成功|审批通过后|锁单成功|推送至|扣减库存|创建订单|出库单创建|发送通知|写入数据库|删除记录)/iu.test(text))
        return "验收点涉及业务写入或外部副作用；需要隔离沙箱、可回滚夹具和明确的操作授权。";
    return "需求没有可直接从目标页面验证的明确预期；需要补充页面入口、字段/控件和期望状态。";
}
/** Explain why a missing-step case did not produce a runnable browser plan.
 * Keep model-draft failure separate from the concrete prerequisite that makes
 * the full case unresolved. */
export function explainBlockedBrowserStepDraft(item: BrowserCheck): string {
    const blocker = browserStepDraftBlockReason(item);
    return canAuthorReadOnlyBrowserSteps(item)
        ? `未生成可执行的只读断言；${blocker ?? "需要页面证据、测试数据或明确的通过条件。"}`
        : blocker ?? "该用例需要非浏览器证据或未满足的明确前置条件。";
}
/** Detect the common bad draft where a specific business case only asserts the
 * generic page shell (for example, `样书申请` for an ERP/approval requirement). */
export function hasOnlyGenericShellAssertions(item: BrowserCheck): boolean {
    const assertions = item.steps.flatMap(step => {
        if ("text" in step)
            return [step.text];
        if ("name" in step)
            return [step.name];
        if ("label" in step)
            return [step.label];
        return [];
    });
    if (!assertions.length)
        return false;
    const genericShell = /^(?:部门样书|样书申请|样书用途|首页|我的|申请记录)$/u;
    if (!assertions.every(value => genericShell.test(value.trim())))
        return false;
    const expectedSpecific = item.expected.replace(/^(?:\[需澄清\]\s*)/u, "").trim();
    return !assertions.some(value => expectedSpecific.includes(value.trim()) && expectedSpecific.length <= value.trim().length + 12);
}
