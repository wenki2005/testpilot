import type { Page } from "playwright";

/** Select a native option by its visible caption, with a safe value fallback. */
export async function selectDocumentOption(page: Page, label: string, value: string, rowIndex = 0): Promise<void> {
  const accessible = page.getByLabel(label, { exact: false }).filter({ visible: true });
  const labeled = accessible.nth(rowIndex);
  if (await labeled.count()) {
    await labeled.selectOption({ label: value }).catch(async () => labeled.selectOption(value));
    return;
  }
  const candidates = await page.locator("select").evaluateAll((elements: Element[], args: { label: string; value: string }) => elements.flatMap((element, index) => {
    if (!(element instanceof HTMLSelectElement)) return [];
    const parentText = [element.closest("label")?.innerText, element.parentElement?.innerText].filter(Boolean).join(" ");
    const hasOption = [...element.options].some(option => option.textContent?.trim() === args.value || option.value === args.value);
    return parentText.includes(args.label) && hasOption ? [index] : [];
  }), { label, value });
  if (rowIndex >= candidates.length) throw new Error(`下拉字段「${label}」只有 ${candidates.length} 个匹配，无法定位第 ${rowIndex + 1} 行。`);
  const select = page.locator("select").nth(candidates[rowIndex]!);
  await select.selectOption({ label: value }).catch(async () => select.selectOption(value));
}

/** Resolve visible form captions used by apps whose markup omits label/aria associations. */
export async function resolveDocumentField(page: Page, label: string, rowIndex = 0) {
  const accessible = page.getByLabel(label, { exact: false }).filter({ visible: true });
  if (await accessible.count()) {
    if (rowIndex >= await accessible.count()) throw new Error(`字段「${label}」只有 ${await accessible.count()} 个可见匹配，无法定位第 ${rowIndex + 1} 行。`);
    return accessible.nth(rowIndex);
  }
  const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select';
  const matches = await page.locator(selector).evaluateAll((elements: Element[], args: { wanted: string; selector: string }) => {
    const needle = args.wanted.replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase();
    return elements.flatMap((element, index) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) || !element.getClientRects().length) return [];
      let parent: Element | null = element;
      for (let depth = 0; depth < 5 && parent; depth++, parent = parent.parentElement) {
        const text = (parent instanceof HTMLElement ? parent.innerText : parent.textContent ?? "").replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase();
        const controls = parent.querySelectorAll(args.selector).length + (parent.matches(args.selector) ? 1 : 0);
        if (text.includes(needle) && controls === 1) return [index];
      }
      return [];
    });
  }, { wanted: label, selector });
  if (matches.length) {
    if (rowIndex >= matches.length) throw new Error(`字段「${label}」只有 ${matches.length} 个可见匹配，无法定位第 ${rowIndex + 1} 行。`);
    return page.locator(selector).nth(matches[rowIndex]!);
  }
  const byTableColumn = await page.locator("table").evaluateAll((tables: Element[], args: { wanted: string; selector: string }) => tables.flatMap(table => {
    const rows = [...table.querySelectorAll("tr")];
    for (const row of rows) {
      const headers = [...row.children];
      const column = headers.findIndex(cell => (cell.textContent ?? "").replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase() === args.wanted.replace(/\s+/g, "").replace(/[：:＊*]/g, "").toLocaleLowerCase());
      if (column < 0) continue;
      return rows.flatMap(dataRow => {
        const cell = dataRow.children[column];
        if (!cell || row === dataRow) return [];
        const control = cell.querySelector(args.selector);
        if (!control || !control.getClientRects().length) return [];
        const index = [...document.querySelectorAll(args.selector)].indexOf(control);
        return index >= 0 ? [index] : [];
      });
    }
    return [];
  }), { wanted: label, selector });
  if (byTableColumn.length) {
    if (rowIndex >= byTableColumn.length) throw new Error(`表格字段「${label}」只有 ${byTableColumn.length} 行，无法定位第 ${rowIndex + 1} 行。`);
    return page.locator(selector).nth(byTableColumn[rowIndex]!);
  }
  throw new Error(`无法定位字段「${label}」；请补充可见字段标签或测试选择器。`);
}

/** Detect invalid styling on either the form control or its immediate field wrapper. */
export function isDocumentFieldInvalid(element: Element): boolean {
  if ("validity" in element && !(element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).validity.valid) return true;
  let node: Element | null = element;
  for (let depth = 0; depth < 4 && node; depth++, node = node.parentElement) {
    if (node.getAttribute("aria-invalid") === "true") return true;
    const classes = typeof node.className === "string" ? node.className : "";
    if (/(?:invalid|error|danger)/i.test(classes)) return true;
    if (node !== element && node.querySelectorAll("input,select,textarea").length > 1) break;
    const style = getComputedStyle(node);
    // Keep this callback self-contained when serialized by Playwright from tsx.
    // A named nested arrow receives an esbuild __name helper unavailable in-page.
    for (const key of ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor"]) {
      const rgb = style[key as "borderTopColor"].match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (rgb && Number(rgb[1]) > 150 && Number(rgb[2]) < 150 && Number(rgb[3]) < 150) return true;
    }
    if (/(?:rgb\(\s*(?:1[6-9]\d|2\d\d)\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\)|#[fF][0-9a-fA-F]{2,5})/.test(style.boxShadow)) return true;
  }
  const ariaDescribedBy = element.getAttribute("aria-describedby")?.split(/\s+/u).filter(Boolean) ?? [];
  return ariaDescribedBy.some(id => {
    const message = element.ownerDocument.getElementById(id);
    return Boolean(message?.getClientRects().length && /(?:invalid|error|格式错误|不能为空|必填)/iu.test(message.textContent ?? ""));
  });
}

/** Select a native or custom option using a unique visible placeholder. */
export async function selectDocumentOptionByPlaceholder(page: Page, placeholder: string, value: string): Promise<void> {
  const locator = page.getByPlaceholder(placeholder, { exact: true }).filter({ visible: true });
  const count = await locator.count();
  if (count !== 1) throw new Error(`占位符「${placeholder}」匹配 ${count} 个控件；需要唯一匹配才能安全选择。`);
  if (await locator.evaluate(element => element instanceof HTMLSelectElement)) {
    await locator.selectOption({ label: value }).catch(async () => locator.selectOption(value));
    return;
  }
  await locator.click();
  const roleOption = page.getByRole("option", { name: value, exact: true });
  const optionCount = await roleOption.count();
  if (optionCount === 1) { await roleOption.click(); return; }
  const visibleText = page.getByText(value, { exact: true });
  const textCount = await visibleText.count();
  if (textCount !== 1) throw new Error(`自定义下拉框「${placeholder}」中选项「${value}」匹配 ${textCount} 项；无法安全选择。`);
  await visibleText.click();
}

/** Select a custom combobox option only when both control and visible option are uniquely identified. */
export async function selectDocumentOptionByRoleIndex(page: Page, index: number, value: string): Promise<void> {
  const controls = page.getByRole("combobox");
  const count = await controls.count();
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error(`页面只有 ${count} 个 combobox，无法选择第 ${index + 1} 个。`);
  const control = controls.nth(index);
  if (!(await control.isVisible())) throw new Error(`第 ${index + 1} 个 combobox 当前不可见。`);
  await control.click();
  const option = page.getByRole("option", { name: value, exact: true });
  const optionCount = await option.count();
  if (optionCount === 1) { await option.click(); return; }
  const visibleText = page.getByText(value, { exact: true }).filter({ visible: true });
  const textCount = await visibleText.count();
  if (textCount !== 1) throw new Error(`选项「${value}」有 ${textCount} 个可见精确匹配；无法安全选择。`);
  await visibleText.click();
}
