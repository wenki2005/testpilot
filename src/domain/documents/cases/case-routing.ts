import { excludedCaseReason } from './case-scope.js';
import type { BrowserCheck, ExecutionRoute } from "../shared/test-model.js";
/** Route each source case to the evidence channel it actually needs. This does
 * not manufacture test data or claim undocumented backend assertions ran. */
export function planCaseExecution(item: Pick<BrowserCheck, "title" | "source" | "expected" | "steps" | "coverageGap" | "confidence">): {
    route: ExecutionRoute;
    reason: string;
    nextAction: string;
} {
    // XMind ancestors carry scope and precondition notes, but they also contain
    // parent-level implementation details (e.g. “call customer API”) that must
    // not turn a leaf assertion such as “matching customer is displayed” into
    // an API-only case. Only inherit explicit release scope from the path; route
    // the verification channel from the leaf's own title/expected result.
    const leafText = `${item.title} ${item.expected} ${item.coverageGap ?? ""}`;
    const text = leafText;
    if (/^\[需澄清\]|待澄清|需澄清|尚未明确/u.test(text))
        return { route: "clarification", reason: "验收范围或通过条件尚未定稿。", nextAction: "由产品负责人确认规则，然后拆成可判定的接受/拒绝用例。" };
    if (/(?:没有指定字段|未指定字段|未明确(?:具体)?(?:字段|格式|非法值|触发时机)|需产品确认.{0,30}(?:字段|格式|非法值))/u.test(text))
        return { route: "clarification", reason: "来源缺少可复现的字段、非法值或触发条件，当前不能写出可靠输入脚本。", nextAction: "补充字段名、非法合成值、触发方式和可观察结果；若触发需要提交，则提供隔离沙箱与回滚方案。" };
    if (/(?:旧|原).{0,60}入口.{0,36}(?:下线|跳转|重定向)/u.test(text) && !/(?:https?:\/\/|(?:旧|新).{0,16}(?:URL|地址|路由)\s*[=:：]\s*\S+)/iu.test(text))
        return { route: "clarification", reason: "旧入口下线/跳转缺少旧地址、新地址及可判定条件，当前页面无法证明入口迁移结果。", nextAction: "补充旧系统 URL、新系统 URL 和预期跳转/下线行为；确认后再加入 URL 断言和允许的导航范围。" };
    const excluded = excludedCaseReason(item);
    if (excluded)
        return { route: 'out-of-scope', reason: excluded, nextAction: '保留原始范围说明；负向验收不得按“不做”关键词跳过。' };
    if (/(?:源代码|源码|OAuth|token.{0,12}(?:存储|明文)|localStorage|静态扫描|依赖漏洞|安全审查)/iu.test(text))
        return { route: "source-review", reason: "验收需要读取源码、构建产物或安全扫描证据，页面操作无法证明。", nextAction: "关联目标仓库/构建产物和安全规则，在源码审查通道执行并附扫描结果。" };
    if (/(?:后端|服务端|数据库|事务|回调|并发|接口契约|契约|接口字段|接口返回|接口异常|落库|库存扣减|锁仓|推送至|审批流|企微审批|旺店通|易诚通|接口调用次数|请求次数|数据一致性|幂等|消息队列|企微消息)/iu.test(text))
        return { route: "api-contract", reason: "验收点涉及服务端、集成或持久化结果；需要核对项目已提供的源码、接口契约和数据读回证据。此分类不代表用户未提供资料。", nextAction: "先检索已绑定的服务端源码、OpenAPI/接口定义和数据库资料；核实目标与读回方式后生成 API/契约用例，仅列出核对后仍缺少的具体项。" };
    if (/(?:账号切换|越权|串号|非本公司员工|在职员工|企微登录|当前登录人|管理员|无权限|直属上级(?!审批节点)|发起人本人|非发起人|被代申请人|审批人)/iu.test(text))
        return { route: "fixture-or-role", reason: "验收依赖特定账号身份、角色或组织关系，当前登录会话不能代表所需身份。", nextAction: "准备专用测试账号/认证态与预期身份数据；保留当前 Edge 登录态，不自动切换用户。" };
    const literalCaption = /^(?:入口页|页面|详情页)?(?:标题(?:为|显示)|文案(?:为|显示)|可见.*(?:链接|标题|文案))/u.test(item.title)
        && item.steps?.some(step => step.action === 'assertExactVisible' && step.text === item.expected);
    if (literalCaption)
        return { route: 'browser-ui', reason: '本条仅验证明确标题或链接的精确可见文案，不断言库存或记录内容。', nextAction: '运行已审核的可见性断言；保留数据和权限验收为独立用例。' };
    if (/(?:\b(?:test|business|product|data|state|order|account|book|customer|inventory)\s+fixtures?\b|夹具|测试数据|历史记录|订单记录|库存|状态记录|脱敏订单|申请单|客户记录|物流轨迹|PC管理后台|后台权限|迁移前基线)/iu.test(text))
        return { route: "fixture-or-role", reason: "需要指定的业务记录、管理后台权限或状态夹具；当前 H5 页面没有证据证明该数据存在。", nextAction: "在隔离环境准备专用权限和可重复的合成 fixture，记录基线、创建与清理方式；后台功能需关联正确的管理端目标。" };
    if (item.steps?.length)
        return { route: "browser-ui", reason: "已有浏览器步骤；执行前仍会校验只读安全和预期覆盖。", nextAction: "运行脚本与 Computer Use，并核对每条验收点的证据。" };
    if (/(?:页面|文案|显示|展示|提示|按钮|字段|输入框|边框|置灰|禁用|布局|移动端|响应式|可见|隐藏|不回显|可选|空状态|列表|分页)/u.test(text))
        return { route: "browser-ui", reason: "这是可观察的页面验收点，但当前没有可靠定位步骤。", nextAction: "依据当前已登录页面的 DOM/可访问性证据补控件定位与断言；定位不唯一时记录精确控件名，不猜 selector。" };
    return { route: "manual-analysis", reason: "来源没有提供足够明确的界面行为、数据或可判定预期，无法安全推导自动操作。", nextAction: "从需求原文补充前置条件、操作、预期结果和验证通道，再生成脚本。" };
}
/** Do not turn an absent record/state assertion into a product failure when
 * the case is routed to a fixture/API/role lane and its browser plan contains
 * no action that could establish the required state. */
export function nonBrowserCaseWithoutStimulus(item: Pick<BrowserCheck, "title" | "source" | "expected" | "steps" | "coverageGap" | "confidence">): {
    route: ExecutionRoute;
    reason: string;
    nextAction: string;
} | undefined {
    const plan = planCaseExecution(item);
    if (!["api-contract", "fixture-or-role", "clarification", "source-review", "manual-analysis"].includes(plan.route))
        return undefined;
    const stimulus = (item.steps ?? []).some(step => ["openRoute", "fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "selectByLabel", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
    return stimulus ? undefined : plan;
}
