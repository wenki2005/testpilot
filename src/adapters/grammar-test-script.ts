export type GrammarStep =
  | { action: "click"; selector: string }
  | { action: "assertText"; selector: string; text: string; match: "exact" | "includes" }
  | { action: "assertVisible"; selector: string }
  | { action: "assertDisabled"; selector: string };

const allowedSelectors = [
  /^#(?:sentence|activity-title|note-count|discover|start-challenge|challenge-feedback|quiz-feedback|open-notebook)$/,
  /^\.sentence$/,
  /^\[data-module="(?:position|quantity|tense|person)"\]$/,
  /^\[data-delta="(?:1|-1)"\]$/,
  /^\[data-key="(?:place|time|height|hair)"\]\[data-value="[A-Za-z ]{1,16}"\]$/,
];

export function validateGrammarSteps(value: unknown): GrammarStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error("Candidate must contain 1 to 12 browser steps.");
  return value.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`Invalid step ${index + 1}.`);
    const item = step as Record<string, unknown>;
    const selector = item.selector;
    if (typeof selector !== "string" || !allowedSelectors.some((pattern) => pattern.test(selector))) throw new Error(`Step ${index + 1} uses a selector outside the registered Grammar Lab surface.`);
    if (item.action === "click") return { action: "click", selector };
    if (item.action === "assertVisible" || item.action === "assertDisabled") return { action: item.action, selector };
    if (item.action === "assertText" && typeof item.text === "string" && item.text.length > 0 && item.text.length <= 240 && (item.match === "exact" || item.match === "includes")) {
      return { action: "assertText", selector, text: item.text, match: item.match };
    }
    throw new Error(`Step ${index + 1} has an unsupported action or arguments.`);
  });
}

export function renderGrammarRunner(): string {
  return `const assert = require('node:assert/strict');
let pw;
try { pw = require('playwright'); } catch { pw = require('C:/Users/A/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'); }
const fs = require('node:fs');
const path = require('node:path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'testpilot-generated.json'), 'utf8'));
(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--disable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:4196');
    for (const step of manifest.steps) {
      const element = page.locator(step.selector);
      if (step.action === 'click') await element.click();
      else if (step.action === 'assertVisible') await assert.ok(await element.isVisible(), step.selector + ' should be visible');
      else if (step.action === 'assertDisabled') await assert.ok(await element.isDisabled(), step.selector + ' should be disabled');
      else if (step.action === 'assertText') {
        const actual = (await element.innerText()).trim();
        if (step.match === 'exact') assert.equal(actual, step.text, step.selector + ' text mismatch');
        else assert.ok(actual.includes(step.text), step.selector + ' should include ' + step.text);
      }
    }
    assert.deepEqual(errors, [], 'page errors');
    console.log(JSON.stringify({ passed: true, title: manifest.title, steps: manifest.steps.length }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
}
