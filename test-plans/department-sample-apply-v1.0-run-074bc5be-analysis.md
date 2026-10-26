# 部门申样书全量运行诊断

- Run：074bc5be-1ad8-4ef8-82b3-64493584b269
- 目标：156/156 条用例；排除 0 条
- 总结：unresolved；双通道最终对齐：否；报告/脚本包：已生成
- 确定性：9/156 条通过（passed 9 / failed 6 / blocked 141）
- Computer Use：7/156 visually verified passed · 6 failed · 143 blocked（passed 7 / failed 6 / blocked 143）

## 为什么大面积阻塞

这不是 141 个已确认产品缺陷，而是 141 条没有进入执行：

- 76 条：该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- 60 条：该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- 5 条：用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。

此外，XMind 156 条基线中仅 46 条有可执行步骤，110 条为空。导入/规划阶段把“需要账号或测试环境”的通用占位前置条件复制到大量页面只读检查上，并通过业务描述关键词将 API/审批/订单词误标为 irreversible；因此只读页面行为也被挡住。

## 步骤为什么不够用

首次对 107 条空步骤调用生成器，模型给每条都写了至少一条，但其中不少只检查“样书申请/样书用途”等通用页面文字，无法证明后端备注、审批、库存、接口、客户过滤等真正预期。根因是工具 schema 强制 steps 至少一项，服务器仅验证 DSL 格式，没有验证断言是否覆盖预期。这批草稿已撤回，项目恢复到之前审核通过的版本。

本轮的 156 条逐条状态仍由原运行器计算；生成脚本包包含完整范围，但这不等同于 156 条都执行成功。

## 已确认产品问题

### case-1｜在企微架构内的在职员工：直接授权登录，进入申请表单页，自动带出姓名/所属公司/部门

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-2｜非本公司员工/不在企微架构：toast提示「暂无申请权限」，不进入表单

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-3｜待澄清 兼职部门员工身份判定数据源与口径（本期仅校验是否在企微架构，兼职暂不涉及）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-4｜本人申请：申请人取当前企微登录人姓名与部门

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-5｜代人申请未选择被代申请人：🔄待澄清 代人申请需填写的被代申请人字段口径

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-6｜后端备注=「发送样书」+该流程企微审批编号+用户选填备注

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-7｜推送至旺店通「样书出库店铺」→ 易诚通其他出库单分类=「样书出库」

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-8｜费用划归客户通常为外部客户（合作客户）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-9｜审批流=企微架构直属上级单级审批

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-10｜页面提示文案「如有调样、周边产品等样书申请需求，请OA申请」

- 确定性：failed；断言失败：没有完全匹配的可见文本：如有调样、周边产品等样书申请需求，请OA申请
- Computer Use：failed；在小额样书申请表单页「样书用途」字段下方可见橙色提示文案，但实际文案为「如有调样、周边产品等样书申请需求，请联系运营OA申请」，与预期精确文案「如有调样、周边产品等样书申请需求，请OA申请」不一致（多出“联系运营”四个字、缺少结尾完全一致的措辞）。逐字比对未通过，故判定 failed。页面另有一条提示「如申请总重超过19公斤，需物流等发货方式请OA申请」不属于本用例断言目标。全程未做任何提交/保存操作。；服务端精确核验未通过：精确文本未出现：如有调样、周边产品等样书申请需求，请OA申请
- 对齐：是；两通道发现同一失败

### case-11｜后端备注=「内部样书」+企微审批编号+用户选填备注

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-12｜推送至旺店通「部门用书店铺」→ 易诚通其他出库单分类=「赠送出库」

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-13｜费用划归客户通常为内部部门（部门费用）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-14｜审批流=直属上级单级审批

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-15｜产品用书不论本数（3本/5本）均归为赠送出库类型

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-16｜本期不展示/不可选（本期不做出版社用书，走物流发货为二/三期）

- 确定性：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- Computer Use：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-17｜1004.00 外部客户—合作客户：正常展示可选

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-18｜1004.06 内部客户—部门费用：正常展示可选

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-19｜其他分类（信用客户1004.01/呆账客户1004.02/内部结算客户1004.03/内部客户其他1004.04/控价不发货1004.05）：不展示

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-20｜待澄清 经销商系统客户接口是否返回「客户分类」字段（后端确认文档，若无则回退名称关键字过滤方案）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-21｜命中关键词：下拉展示匹配客户名称供选择

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-22｜无匹配客户：下拉无结果并提示

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-23｜接口异常：🔄待澄清 客户接口失败时的前端降级提示

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-24｜客户列表为最新数据（非缓存历史快照）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-25｜编码存在：展示图书名称、出版社名称、图书定价(元)、单本重量(公斤)

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-26｜编码不存在/输入错误：输入框边框变红，显示「未获取图书信息」

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-27｜输入非数字：校验拦截，不调用接口

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-28｜待澄清 易诚通回传字段是否含图书单本重量（彭玲玲质疑bic_book_info表无重量字段，需查接口文档，若无则向易诚通提需求补字段）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-29｜正整数（1~9999）：小计=数量×定价，总计=所有图书小计之和，预估总重=∑(数量×单本重量)

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-31｜数量>9999：前端拦截提示超出范围

- 确定性：failed；断言失败：期望文本未出现：超出范围
- Computer Use：failed；在“数量（册）”输入框（约 x=470,y=503）输入 10000 后，小计仍为 0.00、总计 ¥0.00；字段仅显示红色边框，页面任何位置均未出现“超出范围”提示文案。失焦（Tab/点击其他输入框）后数值被静默改写为“999”，仍只有红色边框、无任何错误提示文字。因此“前端拦截提示超出范围”的精确文案未出现，期望结果不满足。观察到的替代行为：静默截断为 999 + 红框，无提示文案。全程未提交/保存。；服务端精确核验未通过：文本未出现：超出范围
- 对齐：是；两通道发现同一失败

### case-32｜P0 所有样书预估总重>19公斤：弹出toast「已超重请修改数量或使用OA申请」，禁止提交

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-33｜新增一行含物流编码、图书数量、图书名称、出版社、定价字段

- 确定性：failed；断言失败：期望文本未出现：物流编码
- Computer Use：failed；Clicking “继续添加样书” visibly added a second blank detail row. The new row shows “自编码”, “数量（册）”, “图书名称”, “出版社”, and “定价(元)”, but the required exact field “物流编码” is absent; “图书数量” is also not shown literally.；服务端精确核验未通过：文本未出现：物流编码
- 对齐：是；两通道发现同一失败

### case-34｜新增行编码同样需通过易诚通校验，否则边框变红

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-35｜每行提供删除按钮，可删除误加的样书行（H5设计稿已确认新增）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-36｜待澄清 样书明细可添加的最大行数限制

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-37｜发货方式固定为「快递」，无其他可选

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-38｜快递公司由旺店通店铺默认快递决定，H5不提供快递选择（同员工福利领书模式）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-42｜为空：字段标红提示必填

- 确定性：failed；断言失败：期望文本未出现：必填
- Computer Use：failed；收货信息 section is visible at y≈460 with required 收件人 input at (547,515) and 提交申请 grayed out. Leaving 收件人 empty and blurring (TAB, then clicking blank area at 350,465) turns the 收件人 input border red (screenshot 4: red border remains while 手机号码 is gray/unfocused), i.e. 字段标红 is present. However no required-field prompt copy appears: no "必填" text (nor any error message) is rendered under/next to the 收件人 field in the empty gap between the 收件人 row and 所在地区 row. The approved assertText "必填" therefore does not match any visible wording. No submit/other side-effecting action was performed; validation beyond blur (e.g., on submit) was not attempted.；服务端精确核验未通过：文本未出现：必填
- 对齐：是；两通道发现同一失败

### case-45｜非11位/含非数字字符：红色提示「手机号格式错误」P1

- 确定性：failed；断言失败：期望文本未出现：手机号格式错误
- Computer Use：failed；在小额样书申请表单「收货信息」区，点击「手机号码」输入框（约 x=1078,y=516）填入 "123"；输入框仅显示红色边框，字段下方及页面任何位置均未出现红色提示文字「手机号格式错误」。又改为输入 "abc"（含非数字字符，约 x=1000,y=516），并分别通过点击「收件人」输入框、点击「备注」输入框及按 TAB 使字段失焦；页面始终没有任何校验提示文案，仅输入框保持红色边框。提交按钮为灰色不可用，未做任何提交/保存操作。期望文字「手机号格式错误」未出现，故判定失败；观测到的唯一反馈为输入框红色描边，无任何提示文案。；服务端精确核验未通过：文本未出现：手机号格式错误
- 对齐：是；两通道发现同一失败

### case-46｜逐级选择成功回填所在地区

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-47｜未选全三级：提交校验标红

- 确定性：passed；确定性用例：检查通过
- Computer Use：blocked；Screenshot shows the exact label 所在地区 with unfilled selectors labeled 请选择省、请选择市、请选择区. The exact control 提交申请 is visible but gray/disabled. No red validation state or message for incomplete three-level selection can be observed, and the disabled button cannot be used to trigger it without a prohibited submit action.
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-49｜未填写：标红提示必填

- 确定性：failed；断言失败：期望文本未出现：必填
- Computer Use：failed；步骤1: 收件信息区块可见 "*详细地址:" 标签及输入框（x≈369-1237, y≈628），输入框为空，placeholder="请输入详细地址信息，如道路、门牌号、小区、楼栋号、单元等"。步骤2: 点击该输入框内部使其获得焦点后按 TAB 失焦（重复两次，结果一致）。步骤3: 观察结果为输入框边框变红（标红成立），但字段下方（y≈655-690）及页面其他位置均无任何 "必填" 文案提示；唯一显示的是 placeholder 文本。按用例要求断言的精确文案 "必填" 未出现（因无同步打字，输入框本身未被清空为脏值，空值校验仅以红框呈现）。结论：标红有效，但缺少 "必填" 文字提示，预期结果 "标红提示必填" 未完整满足。未进行提交/保存等任何副作用操作。；服务端精确核验未通过：文本未出现：必填
- 对齐：是；两通道发现同一失败

### case-50｜全部必填完成且格式正确：提交按钮可点击，跳转至用书审批详情页并创建待审核记录

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-51｜存在漏填或格式校验失败：对应字段输入框标红，不跳转

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-52｜必填未完成时提交按钮置灰不可点击

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-53｜待审核：状态按钮置灰

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-54｜审核通过：状态按钮绿色

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-55｜审核驳回：状态按钮红色，展示驳回原因文案，支持重新申请或联系审批人

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-56｜全部审批状态（待审批/已通过/已驳回/锁单失败/已下单/已发货/已签收/已取消）均展示「查看明细」入口

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-57｜仅申请发起人本人可见并可进入「查看明细」入口

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-58｜代人申请时被代申请人（非发起人）不展示入口，直接访问返回无权限

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-59｜越权：非发起人通过URL/申请单号直接访问他人明细，返回无权限且不展示数据

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-60｜直属上级不在H5端查看明细，改由OA审批表单查看（H5明细入口对上级非必需）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-61｜从明细页返回后回到审批详情页，审批时间轴与状态不丢失

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-62｜长沙快递总仓有货：锁定长沙仓发货

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-63｜长沙仓缺货 → 查天津快递仓有货：锁定天津仓发货

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-64｜两仓均缺货/部分缺货：显示锁单失败，提示「联系运营查看库存/协调库存」

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-65｜开单接口返回错误：前端toast展示错误原因（网络问题/数据格式错误等）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-66｜重新按仓库优先级请求库存查询并再次锁单

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-67｜重试仍缺货：保持锁单失败状态

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-68｜旺店通自动推送易诚通生成其他出库单（同员工福利领书模式，无需额外接口开发）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-69｜物流快递单号回传至H5供员工查看物流轨迹

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-70｜其他出库单号不回传至H5/小程序（仅系统内部记录，用虚拟订单号作网单号追踪，H5不展示该单号）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-71｜// 前置：本期均走旺店通快递仓发货

- 确定性：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- Computer Use：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-72｜不触发物流仓WMS锁定/推送逻辑

- 确定性：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- Computer Use：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-73｜申请单自身字段（申请人/用途/收件信息/备注/数量）实时读申请单记录，与提交内容一致

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-74｜商品关联字段（图书名称/出版社/定价/单本重量）实时调易诚通商品接口拼接最新值

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-75｜多行样书明细逐行展示小计，总计=∑小计、预估总重=∑(数量×单本重量)

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-76｜待澄清 实时读取下若提交后商品定价/重量被调整，明细页金额/总重与提交时及订单/出库单不一致——需确认金额、总重展示「提交时存储值」还是「实时重算值」（建议存储值以保证对账一致）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-77｜商品接口查询失败：对应字段降级提示，不阻塞整页加载

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-78｜收件人/手机号/所在地区/详细地址、备注按提交内容完整原样回显

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-79｜页面纯只读，无编辑/提交/删除入口

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-80｜展示订单号、状态、价格、收货信息、第一种书名称及总本数，分页每次加载20条

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-81｜无订单：展示空状态

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-82｜模糊匹配返回对应订单

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-83｜无匹配：提示无结果

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-84｜展示对应订单详情

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-85｜展示订单号/下单时间/收货人/手机号/地址/总价、图书明细(书名/数量/价格)、订单状态(已下单/已发货/已签收/已取消/已退单)，物流轨迹最新状态置顶，数据来自易查单/自有物流接口每10分钟刷新一次

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-86｜超过72小时无订单信息：显示订单异常，需联系对应运营，订单置为取消状态

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-87｜展示申请编号、申请时间、申请用途、申请人、申请诉求(仅第一本书)及总本数、申请状态

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-88｜申请编号/订单号支持一键复制按钮（H5设计稿已确认新增，便于技术排查）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-89｜按用途筛选（营销用书/产品用书）生效

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-90｜按状态筛选（待审批/已通过/已驳回）生效

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-91｜无符合条件记录：空状态

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-92｜关联企微认证信息正确展示

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-93｜页面平滑切换，数据实时加载，默认展示全部并支持分页20条

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-94｜PC与H5共用代码，通过响应式布局区分展示（识别PC/移动端切换布局），内容与交互与移动端一致

- 确定性：passed；确定性用例：检查通过
- Computer Use：blocked；AI 结果没有匹配当前用例或不符合结果格式。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-95｜// 本期不做统计看板，待后续需求提出时再实现

- 确定性：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- Computer Use：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-96｜本期PC后台仅提供订单明细列表，不提供申请数据统计看板

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-97｜可查看/编辑「员工福利订单」「部门用书订单」页面

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-98｜可查看/编辑「内部订单管理」板块下所有页面

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-99｜「内部订单管理」菜单不可见，直接访问URL返回无权限

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-100｜OA审批通过且锁单成功才创建订单至本页，创建订单时间即下单时间

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-101｜72小时后无物流单状态：订单状态变更为「订单取消」

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-102｜// 已澄清(2026.10.13)：「其他出库单号」本期不做筛选项，已从头部筛选去除

- 确定性：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- Computer Use：blocked；用例前置条件尚未由审核者确认；请先确认测试环境已满足这些条件。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-103｜用书类型筛选（全部/营销用书/产品用书）生效

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-104｜划归客户支持下拉筛选与模糊搜索

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-105｜发货方式（全部/快递仓发货/物流仓发货）筛选生效

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-106｜物流单号/企微审批单号支持模糊与精准搜索

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-107｜展示划归客户、用书类型、发货方式、物流单号、关联企微审批单号、易诚通其他出库单号、备注

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-108｜迁移后菜单入口可达，列表/详情/查询/导出功能与原系统一致

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-109｜迁移后订单数据完整，订单总数、金额、状态与迁移前一致（数据一致性比对）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-110｜原「教师服务系统-员工福利订单」入口下线或跳转至新地址，不再重复展示

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-111｜迁移后按原有筛选项（订单号/客户/状态等）查询结果正确

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-112｜迁移后历史订单详情、物流信息、备注字段无丢失

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-113｜P0 迁移期间存量订单不可访问/丢失：数据迁移回滚校验

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-114｜「内部图书订单管理员」与管理员角色可访问员工福利订单，其他角色不可见

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-115｜推送文案「员工"XXX"发起部门用书申请单，申请单号XXX，请立即查看」至对应上级

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-116｜推送文案「订单锁单失败库存不足，请联系运营查看锁定库存」

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-117｜推送文案「订单72小时未发货，已为你取消订单，请联系运营查看」

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-118｜推送失败：🔄待澄清 消息推送失败是否重试与告警

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-119｜通过template_id创建审批单，审批进度/结果/驳回理由回传至审批详情页

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-120｜接口异常：🔄待澄清 审批接口失败的容错与重试

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-121｜客户接口按客户分类返回（1004.00/1004.06）供H5过滤

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-122｜创建其他出库单后回传快递单号至教师管理系统后台（其他出库单号仅内部记录不回传H5）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-123｜开单返回错误信息：前端toast展示错误原因

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-124｜先查长沙快递总仓，无货再查天津快递仓，按店铺映射发货

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-125｜库存查询失败：进入锁单失败分支

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-126｜每10分钟拉取一次物流最新信息

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-127｜无物流信息且超72小时：置订单异常/取消

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-128｜企微OA审批模板ID配置正确

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-129｜快递仓仓库ID配置正确（长沙仓/天津仓）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-130｜旺店通两个店铺ID配置正确（样书出库店铺/部门用书店铺）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-131｜配置缺失/错误：🔄待澄清 配置异常时的降级与告警策略

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-132｜P0 提示「该图书不存在或尚未入库」，图书名称/定价/重量不回显

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-133｜P0 前端应清空该行 productId 并置红禁止提交（当前仅toast不清空，BUG-013）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-134｜P0 服务端 buildAndCheckGoods 应对 weight 空同口径拒绝，不得按0计放行（当前按0计，BUG-001）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-135｜P0 缺重图书不计入预估总重导致超重样书被提交发货

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-136｜P1 录入 1 与 9999：均放行，小计=数量×定价

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-137｜P1 录入 1000~9999 合法值：前端应允许（当前 max=999 卡死，BUG-003）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-138｜P2 录入 0/负数/小数/字母：拦截，提交按钮不点亮

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-139｜P1 直连API传 qty=99999：后端应拒绝（当前仅校验qty<=0无上限，BUG-003）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-140｜P1 province/city/county 传空：服务端应拒绝（当前未校验，BUG-002）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-141｜P2 receiverPhone=00000000000/12345678901：应按1[3-9]\d{9}拒绝（当前\d{11}放过，BUG-007）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-142｜P2 remark 超30字：服务端应拒绝（当前无长度校验，BUG-008）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-143｜收件人>20字/详细地址>20字：服务端已正确拦截

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-144｜P1 costClientId/costClientName 传空：应必填校验拒绝（当前直接落库，BUG-006）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-145｜P1 bookUsage 空/非法：应显式参数校验提示清晰（当前仅resolveTemplateId间接抛错，BUG-006）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-146｜P1 createApproval成功后落库异常：不得残留孤儿企微审批单（当前事务内先审批后落库，BUG-004）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-147｜P1 回调与补偿Job并发同一单：不重复锁单不重复流转（当前无锁无事务，BUG-005）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-148｜P2 回调报文 spRecords 为null：应判空跳过不抛NPE（当前未判空，BUG-012）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-149｜P0 A登录后同设备交B打开：应识别非本人强制重新授权，B不见A数据（当前有token即用，BUG-010）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-150｜P0 A分享纯URL给B、B自己设备企微打开：B走自己授权拿自己token，不携带A的token

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-151｜P0 B用自己token改applyNo访问A的申请详情/物流：后端applicantUserId归属校验拒绝返回无权限

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-152｜P1 未登录打开深链登录后：应回跳原深链（当前固定跳首页，BUG-011）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-153｜P2 token明文存localStorage、OAuth state固定：应加固（BUG-014）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-154｜P1 已退单订单：应有状态文案（当前后端仅2/3/4/5无退单，BUG-009）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-155｜P2 发货中/审核中/撤回：前端应有对应配色（当前退化默认灰，BUG-009）

- 确定性：blocked；该用例标记的副作用风险为「irreversible」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「irreversible」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。

### case-156｜待澄清 H5是否提供申请编号搜索（后端已支持applyNo入参、PC有搜索框、H5无，BUG-015）

- 确定性：blocked；该用例标记的副作用风险为「unknown」；当前网页 runner 仅执行已审核的只读用例，不执行或自动清理有副作用的流程。
- Computer Use：blocked；该用例标记的副作用风险为「unknown」；当前视觉 runner 仅执行已审核的只读用例。
- 对齐：否；Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。


case-47 是确定性通过、Computer Use 阻塞：脚本只检查提交按钮禁用，未能证明“三级地区未选全时字段标红”；这是脚本断言过弱，需要补准确可观察状态。case-94 本轮脚本只确认标题可见，无法验证移动端布局；上一轮 Computer Use 已报告 390px 视口内容裁切，因此不能宣称响应式通过。

## 已修复的 TestPilot 代码

- 允许步骤规划器返回空步骤，避免用通用标题断言凑数。
- 只对风险明确为只读、前置条件确认、预期清晰的用例生成浏览器步骤；后端、待澄清与账号/夹具依赖保留原因。
- 两条执行通道都拒绝只检查通用页面标题的“假覆盖”。
- 自动运行偏好关闭确认时，更新后只自动批准可执行的安全子集，其余仍逐项阻塞。
- 新增回归测试覆盖以上门禁和响应式溢出断言；本地 TypeScript 检查、server build 与相关单测通过。

当前已运行的服务早于这些代码修改。为了保住当前登录 Edge 会话，本轮没有重启服务；以上代码需服务重载后才会生效。

## 完成 156 条真正验证所需的输入

1. 为 39 条可转为页面行为的用例补齐逐条 DSL 步骤并复核预期。
2. 11 条待澄清用例先从需求方确认判定标准。
3. 其余 API/联调、角色和历史订单类用例需要真实 OpenAPI/接口文档、隔离测试环境、测试账号及可清理夹具；不能在生产站点通过点击提交来伪造覆盖。

运行产物：
- 报告：`artifacts/demo/document-tests/runs/074bc5be-1ad8-4ef8-82b3-64493584b269/report.md`
- 运行 JSON：`artifacts/demo/document-tests/runs/074bc5be-1ad8-4ef8-82b3-64493584b269/run.json`
- 可复用脚本包：`artifacts/demo/document-tests/runs/074bc5be-1ad8-4ef8-82b3-64493584b269/testpilot-package.zip`
