import{connectedEvidenceKind}from'./dify-connected-contract.js';
import type {BrowserCheck} from './document-test-workflow.js';

/** Dify-only coverage gate. Does not change the shared webpage runner. */
export function difyCoverageGap(check:BrowserCheck,reviewedKind?:string):string|undefined {
  const expected=check.expected;
  const steps=check.steps??[];
  if(/正常提交|提交成功|保存成功|成功(?:提交|保存|创建|下单)|创建.{0,10}(?:待审核|记录)|数据.{0,5}落库/u.test(expected))return '原始预期要求提交或创建业务记录；当前 Dify 只读执行未验证该结果，不能用输入回显代替。';
  const assertions=steps.filter(s=>s.action.startsWith('assert'));
  const reviewedValidField=reviewedKind==='recipient-valid'&&expected==='文本≤20字：通过'&&check.source?.includes('填写收件人')||reviewedKind==='phone-valid'&&expected==='11位数字：通过'&&check.source?.includes('填写手机号码')||reviewedKind==='address-valid'&&expected==='手动输入≤20字：通过'&&check.source?.includes('填写详细地址');
  const courierFixed=expected==='发货方式固定为「快递」，无其他可选'||/快递公司由旺店通店铺默认快递决定/u.test(expected);
  if(/无其他可选|无其他选项|不提供.{0,8}选择/u.test(expected)&&!(reviewedKind==='courier-fixed'&&courierFixed&&check.source?.includes('发货方式')))return '原始预期要求固定选项或不存在其他选择，当前步骤没有完整的选项集合断言；仅看到目标文本不能证明没有其他选项。';
  if(/正常展示可选/u.test(expected)&&!(['customer-external','customer-internal'].includes(reviewedKind??'')&&check.source?.includes('客户列表数据范围')&&['1004.00 外部客户—合作客户：正常展示可选','1004.06 内部客户—部门费用：正常展示可选'].includes(expected))&&!(steps.some(s=>s.action.startsWith('select'))&&steps.some(s=>s.action==='assertValue'||s.action==='assertValueByPlaceholder')))return '原始预期要求可选择，当前步骤没有实际选择并核对选中值；控件或选项文字可见不能证明可选择。';
  if(!reviewedValidField&&/通过|有效|合法|校验成功/u.test(expected)&&steps.some(s=>s.action.startsWith('fill'))&&assertions.length>0&&assertions.every(s=>['assertValue','assertValueByPlaceholder','assertVisible','assertRoleVisible'].includes(s.action)))return '原始预期要求校验通过，现有步骤只检查输入回显或控件可见，缺少直接验证校验结果的断言。';
  if(/拦截|校验|非法|负数|小数|为空/u.test(expected)&&steps.some(s=>s.action.startsWith('fill'))&&assertions.some(s=>s.action==='assertRoleDisabled'||s.action==='assertDisabled')&&assertions.every(s=>['assertRoleDisabled','assertDisabled','assertVisible','assertRoleVisible','assertValue','assertValueByPlaceholder'].includes(s.action)))return '仅检查提交按钮禁用不能证明当前字段校验正确；其他必填项也可能导致禁用，需要字段自身错误状态或明确错误提示。';
  const checkedApprovalColor=(reviewedKind==='approved-appearance'||reviewedKind==='rejected-appearance')&&connectedEvidenceKind(check)===reviewedKind;
  if(!checkedApprovalColor&&/按钮.{0,8}(?:绿色|红色)|(?:绿色|红色).{0,8}按钮/u.test(expected))return '原始预期包含按钮颜色，当前固定步骤没有颜色断言；可见性不能证明颜色符合预期。';
  return undefined;
}
