import type {BrowserCheck} from './document-test-workflow.js';
import {actionablePreconditions} from './document-test-workflow.js';
import {reviewDepartmentReadOnly,type DepartmentReadOnlyKind} from './dify-readonly-scenarios.js';
import {reviewDifyBook,type DifyBookKind} from './dify-book-scenarios.js';
import {reviewDifyDevice,type DifyDeviceKind} from './dify-device-scenarios.js';
import {reviewDifyList,type DifyListKind} from './dify-list-scenarios.js';
export type DifyReviewKind='required-empty-disabled'|DepartmentReadOnlyKind|DifyBookKind|DifyDeviceKind|DifyListKind;

export type DifyBlockerCode='write-required'|'business-clarification'|'identity-evidence'|'fixture-required'|'assertion-incomplete'|'steps-missing'|'legacy-review'|'prerequisite-required';
export function difyBlocker(check:BrowserCheck,reason:string):{blockerCode:DifyBlockerCode;detail:string;nextAction:string}{
  const e=check.expected;
  if(/正常提交|提交成功|保存成功|成功(?:提交|保存|创建|下单)|创建.{0,10}(?:待审核|记录)|数据.{0,5}落库/u.test(e))return {blockerCode:'write-required',detail:'原始预期包含真实提交、创建记录或落库，超出本轮只读范围；不能用输入回显代替提交成功。',nextAction:'保留原预期，待明确可写沙箱、操作授权和清理方式后验证。'};
  if(/需澄清|待澄清/u.test(e))return {blockerCode:'business-clarification',detail:'原始用例的业务预期尚未澄清。',nextAction:'确认原始业务口径并建立新版本；不依据当前页面猜测预期。'};
  const source=check.source??'';
  if(source.includes('管理端后台（经销商系统服务端）')||/本期PC后台/u.test(e))return {blockerCode:'identity-evidence',detail:'此条验证经销商管理后台，而当前绑定目标是员工申样 H5；缺少该后台入口、指定角色及对应数据证据。',nextAction:'绑定实际管理后台和有授权的角色会话，准备迁移或订单基线；不能用 H5 页面替代后台验收。'};
  if(source.includes('系统配置依赖'))return {blockerCode:'fixture-required',detail:'此条需要 OA 模板、仓库或店铺配置的权威基线；当前 H5 与测试库连接不能证明部署配置正确。',nextAction:'提供可读的测试环境配置或由配置负责人确认具体 ID，再进行逐项对照；不猜测正确值。'};
  if(source.includes('数据接口层')||source.includes('企微消息通知'))return {blockerCode:'fixture-required',detail:source.includes('企微消息通知')?'缺少对应业务事件、授权通知目标及真实投递证据；Dify 自身执行成功不等于业务通知发送成功。':'此条验证服务端审批、库存、出库或物流集成；当前仅有前端和数据库只读访问，尚无对应事件、接口契约及服务端执行证据。',nextAction:'补齐该集成的测试入口、契约和事件记录；涉及创建、锁单或真实通知时需明确授权，不能仅凭页面文字通过。'};
  if(/当前企微登录人|当前登录人|认证信息正确|企微架构|直属上级|管理员|其他角色|非本公司员工|被代申请人/u.test(e))return {blockerCode:'identity-evidence',detail:'缺少指定身份与页面业务字段的完整对照证据；窗口已登录不等于身份字段已验证。',nextAction:'明确本轮账号/角色及应显示的字段，补姓名、部门或权限的直接对照；不只检查控件可见。'};
  if(/员工端-(?:用书审批详情页|申请表单明细展示页|历史申请记录页|订单列表页|订单详情页)/u.test(source))return {blockerCode:'fixture-required',detail:'此条需要本人可见且状态明确的申请/订单记录；当前空态或成功连接数据库不能证明详情、审批、筛选及分页正确。',nextAction:'按原预期准备本人可见的已有记录和对应状态；仍从同轮网页、接口、数据库对照，不借用他人的申请、不自动造单。'};
  if(source.includes('提交时实时调接口'))return {blockerCode:'write-required',detail:'来源要求在提交时核对最新客户数据；只读搜索成功不能代替提交阶段的实时查询。',nextAction:'在明确授权的可写测试沙箱核对提交事件与最新数据，保留当前只读范围。'};
  if(source.includes('费用划归客户')&&e.startsWith('其他分类'))return {blockerCode:'fixture-required',detail:'需要五种排除分类的明确客户基线与查询证据；仅两个允许分类的可选结果或无匹配空态，不能证明全部排除规则。',nextAction:'补信用、呆账、内部结算、内部其他、控价不发货的分类基线，区分分类排除与无效数据过滤，再逐一核对。'};
  const sampleRowDelete=/每行提供删除按钮|可删除误加的样书行/u.test(e)||(check.steps??[]).some(step=>step.action==='deleteSampleRow');
  if(source.includes('样书明细区')&&!sampleRowDelete&&!/原始用例的业务预期/.test(reason))return {blockerCode:'fixture-required',detail:'图书查询/计算仍缺满足原预期的完整本轮证据；候选编码、定价和重量已找到，不再归因于数据库未连接。',nextAction:'完成确切 bookCheck 只读策略确认、固定图书数据与重量单位核对，再补名称、出版社、价格、数量和重量的完整断言；其他必填为空导致按钮禁用不能代替数量校验。'};
  if(/编码存在|命中关键词|小计.*[=＝]|总计.*[=＝]|∑/u.test(e))return {blockerCode:'fixture-required',detail:'缺少固定图书/客户输入及对应预期数据，或尚无完整数据断言。',nextAction:'准备稳定编码、关键词与预期结果；金额/重量须逐项核算，不能只检查标题可见。'};
  if(/历史记录|申请详情|审批详情|物流轨迹/u.test(e))return {blockerCode:'fixture-required',detail:'需要当前账号可见且状态明确的业务记录。',nextAction:'准备本人可见的已有记录；不借用他人申请，不自动创建申请。'};
  if(/逐级选择|回填|无其他可选|无其他选项|可选择|展示可选/u.test(e)||/断言|不能证明|覆盖/u.test(reason))return {blockerCode:'assertion-incomplete',detail:reason.startsWith('原包状态')||/尚无固定步骤/.test(reason)?'缺少能完整验证选择、回填或选项范围的固定步骤和断言。':reason,nextAction:'补实际操作及对应值/选项全集断言；只看到文字或控件不能算通过。'};
  if(!check.steps.length)return {blockerCode:'steps-missing',detail:reason.startsWith('原包状态')?'原用例尚未形成可靠的只读固定步骤。':reason,nextAction:'基于当前页面补充定位和直接断言，并验证后固化；重复调用 AI 不保证补齐。'};
  if(reason.startsWith('原包状态'))return {blockerCode:'legacy-review',detail:'原包保留了待复核标记，尚未有完整的只读审核计划解除此项。',nextAction:'逐条审查原始预期、实际步骤与副作用边界；保留原包标记，不批量解锁。'};
  return {blockerCode:'prerequisite-required',detail:reason,nextAction:'核对本条明确的前置数据、权限和环境，再只重测该项。'};
}

/** A narrow, source-bound review. No click or submission; every run rechecks live controls. */
export function reviewedDifyReadOnlyPlan(check:BrowserCheck,evidence:string,targetUrl?:string):{kind:DifyReviewKind;steps:BrowserCheck['steps'];detail:string;executionData?:string[]}|undefined {
  const book=reviewDifyBook(check,evidence,targetUrl);if(book)return book;
  const device=reviewDifyDevice(check,evidence,targetUrl);if(device)return device;
  const list=reviewDifyList(check,evidence,targetUrl);if(list)return list;
  const department=reviewDepartmentReadOnly(check,evidence,targetUrl);if(department)return department;
  if(check.expected!=='必填未完成时提交按钮置灰不可点击'||check.steps.length||actionablePreconditions(check).length)return undefined;
  let controls:Array<{name?:string;placeholder?:string}>;try{controls=JSON.parse(evidence).controls??[];}catch{return undefined;}
  if(controls.filter(c=>c.placeholder==='请输入收件人姓名').length!==1||controls.filter(c=>c.name==='提交申请').length!==1)return undefined;
  return {kind:'required-empty-disabled',steps:[{action:'fillByPlaceholder',placeholder:'请输入收件人姓名',value:''},{action:'assertValueByPlaceholder',placeholder:'请输入收件人姓名',value:''},{action:'assertRoleDisabled',role:'button',name:'提交申请'}],detail:'只读审核：明确清空必填收件人、核对为空并检查提交控件禁用；未点击提交。每轮重新核对唯一控件。'};
}
