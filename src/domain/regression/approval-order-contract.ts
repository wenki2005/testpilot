import type { BrowserCheck } from '../documents/shared/test-model.js';
export type ApprovedChainKind = 'approved-stock-readback' | 'approved-outbound-readback' | 'approved-tracking-readback' | 'approved-hidden-outbound' | 'approved-no-wms' | 'approved-timeout' | 'approved-priority' | 'approved-sync' | 'approved-teacher-tracking' | 'approved-tianjin' | 'approved-shortage' | 'approved-retry' | 'approved-retry-shortage' | 'approved-marketing-route';
const bindings: Array<[
    ApprovedChainKind,
    string,
    string
]> = [
    ['approved-stock-readback', '长沙快递总仓有货：锁定长沙仓发货', '员工端-用书审批详情页'],
    ['approved-outbound-readback', '旺店通自动推送易诚通生成其他出库单（同员工福利领书模式，无需额外接口开发）', '员工端-用书审批详情页'],
    ['approved-tracking-readback', '物流快递单号回传至H5供员工查看物流轨迹', '员工端-用书审批详情页'],
    ['approved-hidden-outbound', '其他出库单号不回传至H5/小程序（仅系统内部记录，用虚拟订单号作网单号追踪，H5不展示该单号）', '员工端-用书审批详情页'],
    ['approved-no-wms', '不触发物流仓WMS锁定/推送逻辑', '物流仓WMS锁单与库存优先级'],
    ['approved-timeout', '超过72小时无订单信息：显示订单异常，需联系对应运营，订单置为取消状态', '员工端-订单详情页'],
    ['approved-priority', '先查长沙快递总仓，无货再查天津快递仓，按店铺映射发货', '数据接口层'],
    ['approved-sync', '每10分钟拉取一次物流最新信息', '易查单物流接口'],
    ['approved-teacher-tracking', '创建其他出库单后回传快递单号至教师管理系统后台（其他出库单号仅内部记录不回传H5）', '易诚通接口'],
    ['approved-tianjin', '长沙仓缺货 → 查天津快递仓有货：锁定天津仓发货', '员工端-用书审批详情页'],
    ['approved-shortage', '两仓均缺货/部分缺货：显示锁单失败，提示「联系运营查看库存/协调库存」', '员工端-用书审批详情页'],
    ['approved-retry', '重新按仓库优先级请求库存查询并再次锁单', '锁单失败页重试'],
    ['approved-retry-shortage', '重试仍缺货：保持锁单失败状态', '锁单失败页重试'],
    ['approved-marketing-route', '推送至旺店通「样书出库店铺」→ 易诚通其他出库单分类=「样书出库」', '选择营销用书']
];
export function approvedChainKind(c: Pick<BrowserCheck, 'expected' | 'source'>): ApprovedChainKind | undefined { return bindings.find(([, expected, source]) => c.expected === expected && (c.source ?? '').includes(source))?.[0]; }
export function approvedChainGap(kind: ApprovedChainKind, observation: {
    count: number;
    tracking: number;
    trace: number;
    youngestHours: number;
}) {
    const prefix = `本轮复用${observation.count}笔本人真实已审批、锁单并生成的订单，逐笔核对新GET进度/申请明细/订单明细、页面及独立申请商品数据库；`;
    const gaps: Record<ApprovedChainKind, string> = {
        'approved-stock-readback': '锁单成功已核实；现有响应未提供实际锁定仓库及同笔分仓库存结果，无法独立认定选中长沙仓。图书“常规有货”资料和订单号前缀不替代实际仓库证据。',
        'approved-outbound-readback': '本系统订单已存在；仍未取得同一订单对应的易诚通其他出库单或成功推送回执，不能将本地订单存在等同跨系统出库完成。',
        'approved-tracking-readback': `订单响应中快递单号非空${observation.tracking}笔、物流轨迹非空${observation.trace}笔；尚无真实快递单号/轨迹回传事件。已下单不会自动覆盖已发货链路。`,
        'approved-hidden-outbound': '已核对订单基础内容；尚未定位同一订单的真实内部“其他出库单号”，无法用该号检查H5未泄露及内部虚拟网单映射。空字段或没有展示任意号不能独立证明本条。',
        'approved-no-wms': '只读H5与订单数据不能证明服务端没有WMS锁定/推送事件；仍缺同一申请的完整出站记录或可核验执行分支，不能从页面没有WMS字样推断未调用。',
        'approved-timeout': `新样本距订单创建最短约${observation.youngestHours.toFixed(1)}小时，已有真实订单；没有符合“超过72小时无订单信息”的本人样本，未改创建时间、取消状态或等待假时间。`,
        'approved-priority': '实际锁单成功已核实；仍缺同一事件中长沙查询→无货→天津查询与店铺映射的真实读回。指定库存资料不能代替执行时分仓库存，本轮不修改实际库存。',
        'approved-sync': `现有订单快递单号非空${observation.tracking}笔、轨迹非空${observation.trace}笔；仍缺至少两次带时间的服务端物流拉取执行证据。浏览器重查和相同空响应不能证明后台10分钟任务执行。`,
        'approved-teacher-tracking': '申样订单已核实；尚无同笔其他出库单及其快递单号到教师管理后台的独立读回，不能用员工订单页面代替该跨系统回传。',
        'approved-tianjin': '指定天津图书对应申请现已通过并锁单建单；仍无同笔实际锁定仓库及长沙当时无货、天津有货的独立读回，不能由书号或订单前缀推定天津仓。',
        'approved-shortage': '两仓无货/部分不足候选图书对应申请均已通过并锁单建单，没有触发锁单失败。历史库存资料及“如5本”示例不等于本次实时可锁量，尚不能判缺货分支通过或产品失败。',
        'approved-retry': '当前候选申请实际锁单成功；未取得锁单失败且可重试的本人状态样本，不对已成功订单重复锁单。现有正常订单不会覆盖失败后重试分支。',
        'approved-retry-shortage': '当前候选申请实际锁单成功；未取得失败后重试仍不足的真实事件，不修改库存或伪改状态制造失败，保留该分支未覆盖。',
        'approved-marketing-route': '本人营销申请已真实审批通过并建单；员工/管理订单响应未提供同一订单的旺店通店铺ID或最终易诚通出库分类，仍缺这两项实际读回。'
    };
    return prefix + gaps[kind] + ' 不再归为本人无申请或无订单；本轮完成可做子检查，原预期保留阻塞。';
}
