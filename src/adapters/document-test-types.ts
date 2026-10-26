export const caseCategories = [
  "functional", "input-validation", "boundary", "authentication", "authorization",
  "state-transition", "navigation", "accessibility", "visual", "security",
  "performance", "compatibility", "resilience", "other",
] as const;
export type CaseCategory = typeof caseCategories[number];
export const caseCategoryLabels: Record<CaseCategory, string> = {
  functional: "功能流程", "input-validation": "输入校验", boundary: "边界条件", authentication: "身份认证",
  authorization: "权限控制", "state-transition": "状态流转", navigation: "导航跳转", accessibility: "无障碍",
  visual: "视觉布局", security: "安全", performance: "性能", compatibility: "兼容性", resilience: "异常恢复", other: "其他",
};

export const caseConfidences = ["high", "medium", "low"] as const;
export type CaseConfidence = typeof caseConfidences[number];

const categoryPatterns: Array<[CaseCategory, RegExp]> = [
  ["authorization", /权限|授权|角色|越权|permission|authorization|role/i],
  ["authentication", /登录|登出|身份认证|扫码|密码|验证码|authentication|sign.?in|log.?in/i],
  ["security", /安全|注入|跨站|csrf|xss|加密|脱敏|敏感信息|security/i],
  ["input-validation", /校验|验证|必填|格式|非法|错误提示|validation|invalid|required/i],
  ["boundary", /边界|最大|最小|上限|下限|临界|范围|boundary|limit|maximum|minimum/i],
  ["state-transition", /状态|流转|切换|变更|撤回|审批|转.*状态|transition|workflow/i],
  ["navigation", /导航|跳转|路由|返回|页面入口|navigation|route|redirect/i],
  ["accessibility", /无障碍|键盘|读屏|屏幕阅读|焦点|可访问性|accessibility|keyboard|screen reader/i],
  ["visual", /布局|颜色|样式|显示效果|视觉|对齐|遮挡|visual|layout|responsive/i],
  ["performance", /性能|响应时间|并发|吞吐|加载速度|performance|latency|throughput/i],
  ["compatibility", /兼容|浏览器|设备|分辨率|移动端|compatibility|browser matrix/i],
  ["resilience", /异常恢复|重试|断网|超时|失败恢复|服务不可用|resilience|retry|timeout|recovery/i],
];

export function inferCaseCategory(source: string): CaseCategory {
  for (const [category, pattern] of categoryPatterns) if (pattern.test(source)) return category;
  return "functional";
}

export function confidenceFromExpectation(expected: string): CaseConfidence {
  return /^\[(?:需澄清|请在)/u.test(expected.trim()) ? "low" : "medium";
}
