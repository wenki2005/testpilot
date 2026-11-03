import type {BrowserCheck} from './document-test-workflow.js';
import {actionablePreconditions} from './document-test-workflow.js';
import {reviewDepartmentReadOnly,type DepartmentReadOnlyKind} from './dify-readonly-scenarios.js';
import {reviewDifyBook,type DifyBookKind} from './dify-book-scenarios.js';
import {reviewDifyDevice,type DifyDeviceKind} from './dify-device-scenarios.js';
import {reviewDifyList,type DifyListKind} from './dify-list-scenarios.js';
import {reviewFieldValidity,type FieldValidityKind} from './dify-field-validity-scenarios.js';
import {reviewDifyRecord,type DifyRecordKind} from './dify-record-scenarios.js';
import {reviewInvalidBook,type InvalidBookKind} from './dify-invalid-book-scenarios.js';
import {reviewExcludedCustomer} from './dify-excluded-customer-scenarios.js';
import {reviewClientValidation,type ClientValidationKind} from './dify-client-validation-scenarios.js';
import {reviewApplicantIdentity} from './dify-applicant-identity-scenarios.js';
import{reviewConnectedEvidence}from'./dify-connected-scenarios.js';
import type{ConnectedKind}from'./dify-connected-contract.js';
export type DifyReviewKind='required-empty-disabled'|DepartmentReadOnlyKind|DifyBookKind|DifyDeviceKind|DifyListKind|FieldValidityKind|DifyRecordKind|InvalidBookKind|'excluded-customer'|ClientValidationKind|'applicant-identity'|ConnectedKind;

export type DifyBlockerCode='write-required'|'business-clarification'|'identity-evidence'|'fixture-required'|'assertion-incomplete'|'steps-missing'|'legacy-review'|'prerequisite-required';
export function difyBlocker(check:BrowserCheck,reason:string):{blockerCode:DifyBlockerCode;detail:string;nextAction:string}{
  const e=check.expected;
  if(e==='未选全三级：提交校验标红'&&check.source.includes('省/市/区三级联动'))return {blockerCode:'assertion-incomplete',detail:'原预期要求未选全省市区时触发提交校验并标红；现有失焦步骤无法证明提交时校验，且地区标签对应三个控件。完整表单基线、隔离网络的客户端校验和地区组错误断言尚未建立。',nextAction:'保留原预期；补齐其他字段有效的基线，在禁止外发请求的校验动作下确认未选全地区的错误状态，不能用其他必填为空导致的禁用代替。'};
  if(/正常提交|提交成功|保存成功|成功(?:提交|保存|创建|下单)|创建.{0,10}(?:待审核|记录)|数据.{0,5}落库/u.test(e))return {blockerCode:'write-required',detail:'本条需要真实提交或落库核对，尚未由当前任务的专用授权写入路径完成；不能用输入回显代替业务成功。',nextAction:'核对测试目标、账号、写入执行日志及本条专用步骤；结果未知先按唯一标记查库，避免重复提交。'};
  if(/需澄清|待澄清/u.test(e))return {blockerCode:'business-clarification',detail:'原始用例的业务预期尚未澄清。',nextAction:'确认原始业务口径并建立新版本；不依据当前页面猜测预期。'};
  const source=check.source??'';
  if(e==='不触发物流仓WMS锁定/推送逻辑'&&source.includes('本期不做'))return{blockerCode:'prerequisite-required',detail:'这是本期“不触发WMS”的负向验收，未按后续功能分支跳过。当前网页和数据库状态不能证明后台没有发出WMS调用，尚缺该流程的调用审计/发送记录。',nextAction:'绑定可只读核验的WMS调用或发送审计，按申请/流程关联断言无调用；不是要求重复连接数据库或只补一条本人记录。'};
  if(source.includes('员工端-申请表单明细展示页')&&/实时调易诚通商品接口|商品接口查询失败/.test(e))return{blockerCode:'assertion-incomplete',detail:'该用例需要商品实时查询或正确链路的失败降级断言。已有本人记录、数据库和成功详情响应可供对照，但现有步骤尚未绑定上游实时调用或对应失败响应，不能统一归因于没有本人数据。',nextAction:'补明细商品字段对照，并定位上游调用/失败注入点；不能以无关bookCheck请求或页面标题代替完整预期。'};
  if(source.includes('管理端后台（经销商系统服务端）')||/本期PC后台/u.test(e))return {blockerCode:'identity-evidence',detail:'此条验证经销商管理后台，而当前绑定目标是员工申样 H5；缺少该后台入口、指定角色及对应数据证据。',nextAction:'绑定实际管理后台和有授权的角色会话，准备迁移或订单基线；不能用 H5 页面替代后台验收。'};
  if(source.includes('系统配置依赖'))return {blockerCode:'fixture-required',detail:'此条需要 OA 模板、仓库或店铺配置的权威基线；当前 H5 与测试库连接不能证明部署配置正确。',nextAction:'提供可读的测试环境配置或由配置负责人确认具体 ID，再进行逐项对照；不猜测正确值。'};
  if(source.includes('数据接口层')||source.includes('企微消息通知'))return {blockerCode:'fixture-required',detail:source.includes('企微消息通知')?'已支持授权提交；本条仍缺与申请关联的通知对象、准确文案和真实投递证据，不能以提交成功或Dify执行成功替代。':'已支持测试环境真实提交及落库核对；本条仍需对应审批回传、库存、出库或物流事件的服务端接口契约和执行证据。',nextAction:'继续使用已创建的测试记录定位后续业务入口、事件与回执；只有字段/状态值不代表相应服务端流程实际执行。'};
  if(/当前企微登录人|当前登录人|认证信息正确|企微架构|直属上级|管理员|其他角色|非本公司员工|被代申请人/u.test(e))return {blockerCode:'identity-evidence',detail:'缺少指定身份与页面业务字段的完整对照证据；窗口已登录不等于身份字段已验证。',nextAction:'明确本轮账号/角色及应显示的字段，补姓名、部门或权限的直接对照；不只检查控件可见。'};
  if(/员工端-(?:用书审批详情页|申请表单明细展示页|历史申请记录页|订单列表页|订单详情页)/u.test(source))return {blockerCode:'fixture-required',detail:'此条需要本人可见且状态明确的申请/订单记录；当前空态或成功连接数据库不能证明详情、审批、筛选及分页正确。',nextAction:'按原预期准备本人可见的已有记录和对应状态；仍从同轮网页、接口、数据库对照，不借用他人的申请、不自动造单。'};
  if(source.includes('提交时实时调接口'))return {blockerCode:'assertion-incomplete',detail:'已有真实提交及客户字段落库证据；来源还要求提交时重新拉取最新客户数据。尚未取得该阶段的上游调用或可控数据变化对照，不能用提交前搜索成功替代。',nextAction:'为同一提交关联客户查询链路或独立数据变化基线；数据库最终值一致只能证明内容，不能单独证明非缓存取数过程。'};
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
  check={...check,source:check.source??''};
  const connected=reviewConnectedEvidence(check,evidence,targetUrl);if(connected)return connected;
  const validation=reviewClientValidation(check,evidence,targetUrl);if(validation)return validation;
  const applicant=reviewApplicantIdentity(check,evidence,targetUrl);if(applicant)return applicant;
  const record=reviewDifyRecord(check,evidence,targetUrl);if(record)return record;
  const invalidBook=reviewInvalidBook(check,evidence,targetUrl);if(invalidBook)return invalidBook;
  const excluded=reviewExcludedCustomer(check,evidence,targetUrl);if(excluded)return excluded;
  const field=reviewFieldValidity(check,evidence,targetUrl);if(field)return field;
  const book=reviewDifyBook(check,evidence,targetUrl);if(book)return book;
  const device=reviewDifyDevice(check,evidence,targetUrl);if(device)return device;
  const list=reviewDifyList(check,evidence,targetUrl);if(list)return list;
  const department=reviewDepartmentReadOnly(check,evidence,targetUrl);if(department)return department;
  if(check.expected!=='必填未完成时提交按钮置灰不可点击'||check.steps.length||actionablePreconditions(check).length)return undefined;
  let controls:Array<{name?:string;placeholder?:string}>;try{controls=JSON.parse(evidence).controls??[];}catch{return undefined;}
  if(controls.filter(c=>c.placeholder==='请输入收件人姓名').length!==1||controls.filter(c=>c.name==='提交申请').length!==1)return undefined;
  return {kind:'required-empty-disabled',steps:[{action:'fillByPlaceholder',placeholder:'请输入收件人姓名',value:''},{action:'assertValueByPlaceholder',placeholder:'请输入收件人姓名',value:''},{action:'assertRoleDisabled',role:'button',name:'提交申请'}],detail:'只读审核：明确清空必填收件人、核对为空并检查提交控件禁用；未点击提交。每轮重新核对唯一控件。'};
}
