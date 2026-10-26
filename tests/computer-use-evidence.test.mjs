import test from 'node:test';
import assert from 'node:assert/strict';

test('case-154 and case-155 missing order fixtures are blocked, never product failures', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');
  const cases = [
    {
      id: 'case-154',
      evidence: '订单物流页列表为空“暂无订单物流记录”；无含“已退单”状态的订单 fixture。',
      failure: '文本未出现：已退单',
    },
    {
      id: 'case-155',
      evidence: '历史申请记录显示“暂无申请记录”，订单物流显示“暂无订单物流记录”；无法观察任一目标状态或配色。',
      failure: '文本未出现：发货中',
    },
  ];

  for (const item of cases) {
    const result = classifyComputerUseEvidence({
      recordedStatus: 'failed',
      recordedEvidence: item.evidence,
      assertionFailures: [item.failure],
    });
    assert.equal(result.status, 'blocked', `${item.id}: ${result.detail}`);
    assert.match(result.detail, /缺少可判定产品行为的证据/u);
  }
});

test('only affirmative contradictory evidence can classify a Computer Use result as failed', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');

  const observedWrongValue = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '目标订单行可见，状态列显示“已取消”，而该行预期状态为“已退单”。',
    assertionFailures: ['字段值不匹配：订单状态 第 1 行'],
  });
  assert.equal(observedWrongValue.status, 'failed');

  const modelOnlyFailure = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '模型认为预期表现不正确，但没有提供可见矛盾证据。',
  });
  assert.equal(modelOnlyFailure.status, 'blocked');

  const explicitPositiveContradiction = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: '目标记录可见，状态为“已取消”，与预期不符。',
    positiveContradiction: true,
  });
  assert.equal(explicitPositiveContradiction.status, 'failed');
});

test('Computer Use flags a numeric value clamped on blur as a visible product failure', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');
  const result = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '输入 1000，聚焦时显示“1000”；点击“自编码”输入框失焦后，该值被改为“999”。输入 9999 后失焦同样被改为“999”，违反期望“前端应允许”。',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：数量（册）'],
    coverageGap: '尚未验证服务端是否允许该值。',
  });
  assert.equal(result.status, 'failed');

  const english = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: 'Entering 1000 showed 1000 while focused, but after Tab blur the field visibly changed to 999. Entering 9999 did the same, so the front end does not allow either legal value.',
    unverifiedAssertions: ['Unable to verify field value through the DOM locator'],
    coverageGap: 'Server-side acceptance remains unverified.',
  });
  assert.equal(english.status, 'failed');

  // Actual full-run narration: it describes typing, focus, and readback in a
  // longer sentence than the compact fixture above. Keep this regression so
  // affirmative UI evidence cannot be downgraded to blocked by wording drift.
  const fullRunNarrative = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: '在数量输入框依次录入并失焦读回：1) 单击输入框后键入 1000，失焦后字段值显示为「999」；2) 再次单击输入框、Ctrl+A 全选后键入 9999，失焦后字段值同样显示为「999」。即前端在失焦时把合法值截断/夹取为上限 999，与预期不符。',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：数量（册）'],
    coverageGap: '服务端是否接受该值仍待 API 验证。',
  });
  assert.equal(fullRunNarrative.status, 'failed', fullRunNarrative.detail);

  const capturedFullRunNarrative = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: 'The 数量（册） input was typed as "1000"; it showed "1000" while focused. After clicking away (blur), the field was reset to "999". Repeating with "9999" again reverted to "999". So the frontend does not allow the legal values 1000~9999, contradicting the expected outcome.',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：数量（册）'],
    coverageGap: 'Server-side persistence remains unverified.',
  });
  assert.equal(capturedFullRunNarrative.status, 'failed', capturedFullRunNarrative.detail);

  const exactAgentNarrative = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: 'In 样书明细 › 数量（册）, typing 1000 showed 1000 while focused, but after clicking away the field visibly changed to 999. Replacing it with 9999 likewise showed 9999 while focused, then visibly changed to 999 after blur.',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：数量（册）'],
    coverageGap: 'Server-side acceptance remains unverified.',
  });
  assert.equal(exactAgentNarrative.status, 'failed', exactAgentNarrative.detail);

  const chineseTabNarrative = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: '数量（册）输入框可见。录入 1000 后离开字段，值被改为 999；再录入 9999 后离开字段，值同样被改为 999。前端未按预期保留 1000~9999 的合法值，复现 max=999 截断问题。按清理要求未提交或保存，因此服务端/最终保存行为未验证。',
    coverageGap: '服务端/最终保存行为未验证。',
  });
  assert.equal(chineseTabNarrative.status, 'failed', chineseTabNarrative.detail);

  const chineseAutoRewriteNarrative = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: '输入 1000 后聚焦时框内显示 "1000"，按 TAB 失焦后同一输入框被自动改写为 "999"；再次输入 9999，失焦后同样被钳制为 "999"。与期望前端允许 1000~9999 相反。',
    coverageGap: '服务端保存结果仍未验证。',
  });
  assert.equal(chineseAutoRewriteNarrative.status, 'failed', chineseAutoRewriteNarrative.detail);
});

test('Computer Use recognizes nonnumeric input that visibly triggers lookup without validation', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');
  const result = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: 'Typed non-numeric value ABC and blurred. The lookup request was triggered and loading appeared, but no validation intercepted the value; the border returned to normal.',
    coverageGap: 'The UI evidence does not prove server behavior.',
  });
  assert.equal(result.status, 'failed', result.detail);
});

test('a missing expected UI assertion is a failure unless the target fixture itself is unavailable', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');

  const missingVisibleCopy = classifyComputerUseEvidence({
    recordedStatus: 'passed',
    recordedEvidence: 'The target page loaded and the expected heading is not visible.',
    assertionFailures: ['精确文本未出现：请填写申请理由'],
  });
  assert.equal(missingVisibleCopy.status, 'failed');

  const missingFixtureRecord = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '订单物流页显示“暂无订单物流记录”；无法观察目标物流状态。',
    assertionFailures: ['文本未出现：发货中'],
  });
  assert.equal(missingFixtureRecord.status, 'blocked');
});

test('an expected empty-state message is pass evidence, while visible responsive overflow is a product failure', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');

  const expectedEmptyState = classifyComputerUseEvidence({
    recordedStatus: 'passed',
    recordedEvidence: '订单物流页面截图可见“全部 0”及精确空状态“暂无订单物流记录”，与无订单用例预期一致。',
  });
  assert.equal(expectedEmptyState.status, 'passed', expectedEmptyState.detail);

  const responsiveOverflow = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: '390x844截图仍是桌面式两栏布局，标题和内容被右边缘裁切，出现横向溢出，未按移动宽度重排。',
    coverageGap: '无法证明PC与H5底层是否复用同一份代码。',
  });
  assert.equal(responsiveOverflow.status, 'failed', responsiveOverflow.detail);
});

test('specific screenshot-confirmed UI values can pass when the independent DOM label locator is unavailable', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');
  const result = classifyComputerUseEvidence({
    recordedStatus: 'passed',
    recordedEvidence: '截图可见输入后输入框完整呈现“测试收件人”，字符未截断且没有校验错误提示。',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：收件人'],
  });
  assert.equal(result.status, 'passed', result.detail);

  const englishScreenshot = classifyComputerUseEvidence({
    recordedStatus: 'passed',
    recordedEvidence: 'Screenshot-visible evidence shows the labeled field accepts the manually entered value “测试地址一号”; the exact text remains displayed in the focused input.',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：详细地址'],
  });
  assert.equal(englishScreenshot.status, 'passed', englishScreenshot.detail);

  const validPhone = classifyComputerUseEvidence({
    recordedStatus: 'passed',
    recordedEvidence: '输入后字段完整显示“13800138000”；失焦后边框恢复为普通灰色状态，未出现校验错误提示，说明合法号码被接受。',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：手机号码'],
  });
  assert.equal(validPhone.status, 'passed', validPhone.detail);

  const incomplete = classifyComputerUseEvidence({
    recordedStatus: 'passed',
    recordedEvidence: '输入后截图显示输入框完整呈现“测试收件人”。',
    unverifiedAssertions: ['无法通过 DOM 定位器复核字段值：收件人'],
    coverageGap: '实际提交链路未验证。',
  });
  assert.equal(incomplete.status, 'blocked', incomplete.detail);
});

test('an observed invalid-input state without the required error styling is a visible product failure', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');
  const result = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '输入非数字ABC后失焦，字段仍为默认灰色边框，未观察到校验拦截或错误提示。',
    coverageGap: '视觉通道不能确认是否发出网络请求。',
  });
  assert.equal(result.status, 'failed', result.detail);
});

test('inconclusive evidence and missing role/fixture prerequisites do not become product failures from blank-page assertions', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');

  const missingRole = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '无法进入个人信息页核对关联账号；需要主管测试账号和审批记录。',
    assertionFailures: ['精确控件未出现：tab「我的」'],
  });
  assert.equal(missingRole.status, 'blocked');

  const missingFixture = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '缺少不存在图书编码 fixture，无法触发 bookCheck 验证提示。',
    assertionFailures: ['文本未出现：该图书不存在或尚未入库'],
  });
  assert.equal(missingFixture.status, 'blocked');

  const explicitlyInconclusive = classifyComputerUseEvidence({
    recordedStatus: 'inconclusive',
    recordedEvidence: '当前页面没有目标申请记录，无法观察审批状态。',
    assertionFailures: ['文本未出现：待审批'],
  });
  assert.equal(explicitlyInconclusive.status, 'blocked');
});

test('an explicitly non-attributable disabled state is blocked even when the narrative notes missing validation UI', async () => {
  const { classifyComputerUseEvidence } = await import('../src/adapters/computer-use-evidence.ts');
  const quantityCase = classifyComputerUseEvidence({
    recordedStatus: 'failed',
    recordedEvidence: '数量输入框接受 0、-1、1.5、abc，未出现数量相关的行内报错或拦截提示。提交申请按钮保持灰色，但样书用途、收件人、手机号、所在地区和自编码等必填项均为空，无法据此判定按钮禁用是数量校验造成；未点击提交。',
    assertionFailures: ['未观察到数量相关的拦截提示文案'],
    coverageGap: '缺少可填的非个人测试数据，不能隔离出数量校验结果。',
  });
  assert.equal(quantityCase.status, 'blocked', quantityCase.detail);
});
