export type DatabaseEvidenceRow = Record<string, string | number | null>;
export type DocumentDatabaseEvidence = {
  id: string; projectId: string; capturedAt: string; database: string; readonly: true;
  encrypted: boolean; certificateVerified: boolean; sha256: string;
  queries: Array<{ key: string; rows: DatabaseEvidenceRow[] }>;
  applicationChecks: Array<{ applyNo: string; goodsCount: number; quantityTotal: number; amount: string; weightGrams: string; amountConsistent: boolean; weightConsistent: boolean }>;
  limitation: string;
};

/** Exact decimal arithmetic: prices in cents; persisted gram values in thousandths. */
function scaled(value: unknown, places: number): bigint {
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/u.test(text)) throw new Error('数据库金额或重量格式无效。');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > places && /[1-9]/u.test(fraction.slice(places))) throw new Error('数据库小数精度超出可核验范围。');
  return BigInt(whole!) * 10n ** BigInt(places) + BigInt((fraction + '0'.repeat(places)).slice(0, places));
}
const decimal = (value: bigint, places: number) => `${value / 10n ** BigInt(places)}.${(value % 10n ** BigInt(places)).toString().padStart(places, '0')}`;
export function checkDatabaseApplicationTotals(applications: DatabaseEvidenceRow[], goods: DatabaseEvidenceRow[]): DocumentDatabaseEvidence['applicationChecks'] {
  return applications.map(application => {
    const rows = goods.filter(row => String(row.apply_no) === String(application.apply_no));
    let cents = 0n, grams = 0n, quantityTotal = 0;
    let storedAmountsAgree = true, storedWeightsAgree = true;
    for (const row of rows) {
      const qty = Number(row.qty);
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1_000_000) throw new Error('数据库图书数量无法进行有界核验。');
      const subtotal = scaled(row.price, 2) * BigInt(qty), weight = scaled(row.unit_weight, 3) * BigInt(qty);
      cents += subtotal; grams += weight; quantityTotal += qty;
      storedAmountsAgree &&= subtotal === scaled(row.subtotal, 2);
      storedWeightsAgree &&= weight === scaled(row.total_weight, 3);
    }
    return { applyNo: String(application.apply_no), goodsCount: rows.length, quantityTotal, amount: decimal(cents, 2), weightGrams: decimal(grams, 3),
      amountConsistent: rows.length > 0 && storedAmountsAgree && cents === scaled(application.total_amount, 2),
      weightConsistent: rows.length > 0 && storedWeightsAgree && grams === scaled(application.total_weight, 3) };
  });
}
