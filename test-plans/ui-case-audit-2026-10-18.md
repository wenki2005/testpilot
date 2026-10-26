# UI case audit — 2026-10-18

## Scope and verdict
Read-only review of active project `624a5e81-e79e-493f-a746-8accc5c44b90` (156 cases), full run `074bc5be-1ad8-4ef8-82b3-64493584b269`, and draft `department-sample-apply-v1.0-step-drafts-2026-10-18.json`. No target website, browser, or credentials were accessed. The full run is not 156 assertions: deterministic 9 passed/6 failed/141 blocked; Computer Use 7 passed/6 failed/143 blocked. Only a narrow subset can be truly asserted by the currently bounded browser DSL, assuming reviewed steps, safe test fixtures and selectors are available. Draft status is explicitly unapproved/unexecuted.

## Truly browser-assertable candidates
The audit inventory labels 15 cases `browser-ready`: `case-10, 30, 31, 33, 39, 40, 41, 42, 43, 44, 45, 47, 48, 49, 94`. Of these, direct DSL assertion scope is limited:

- `case-10`: exact visible copy; current run already confirms mismatch (actual includes “联系运营”). Fail is supportable.
- `case-30, 31, 33, 39-45, 48-49`: browser-visible static/field states may be asserted if current steps target the specified exact content/values. The inventory marks them ready; this audit cannot certify actual target behavior without execution.
- `case-47`: do **not** accept current pass. Existing script checks only disabled submit, not the required red invalid state of the region field. This is a known false pass/undercoverage.
- `case-94`: only viewport overflow on the current route is expressible with `setViewport` + `assertNoHorizontalOverflow`; the requirement spans application, history and order/logistics routes. Current run/script does not establish all routes and prior visual result reported 390px clipping. Not a full pass.

Additional proposed direct-UI assertion candidates in the new draft: `case-26, 34, 35, 37, 38, 52, 132, 138`. They are candidates only after label/selector/text verification and safe preconditions; see draft review below. The project’s earlier “9 UI candidates” list additionally includes `case-133`, but its hidden-state clause makes it partial. `case-137` is partial.

## Candidate draft quality and safety
Draft cases: `26, 34, 35, 37, 38, 52, 79, 94, 132, 133, 137, 138`.

- **26**: invalid code → invalid field + exact “未获取图书信息”. Maps to visible clauses. Needs a deterministic invalid-code fixture; otherwise error could be network/unknown. Label must be confirmed.
- **34**: adds a row then enters invalid code; maps to invalid border, but omits the expected failure message/API validation behavior. “图书编码” may be ambiguous when multiple rows exist. Use row-scoped locator support or avoid claiming exact row coverage. Adding a blank row is reversible UI-only.
- **35**: adding one row then checking a delete button proves presence, not that each row has a delete control or deletion works. It safely avoids clicking delete, but undercovers “可删除”. Destructive click is intentionally omitted.
- **37**: assertions that “快递” is visible and “自提”/“快递公司” absent do not prove the shipping control is fixed/has no other options. Step navigates via a potentially unstable link. Scope to form and assert disabled/read-only control or option set if DSL supports it.
- **38**: absence of selector text only supports “H5 does not offer courier choice”; cannot prove courier company is determined by WDT store default without backend/config evidence. Also lacks positive shipping-mode check.
- **52**: button disabled on untouched form supports required-incomplete gating, but does not prove all required fields or formatting validation. Button name “提交申请” must be confirmed.
- **79**: correctly blocked pending existing application fixture and details URL; without them no meaningful read-only assertion.
- **94**: partial, only overflow on currently open route at 390x844 and 1280x800. Missing history and logistics page routes/records plus interaction equivalence.
- **132**: uses generic invalid code, which cannot prove the special “weight empty” backend rejection. Empty value assertions are relevant only after a known weight-empty book fixture triggers the exact path. Field labels are unverified.
- **133**: visible invalid/error/disabled checks cover UI consequences only; cannot observe hidden `productId` clearing. Needs approved internal-state/API evidence; do not claim full pass.
- **137**: value retention for 1000 and 9999 supports input range only; does not prove accepted submission, subtotal calculation, or backend limits. Requires valid book fixture/price for those clauses.
- **138**: repeated invalid values and disabled check is plausible UI-only validation, but exact field behavior and submit button name (“提交” versus “提交申请”) need verification. It does not prove API is not called; that requires network/API instrumentation. No submit action is performed.

No draft is approved or executed. Any navigation/click should be reviewed in original authenticated session. Avoid submit, delete, approval, shipment and integration side effects.

## Exact blocker groups and evidence needed
Existing blocker audit groups (IDs exhaustive; these reflect disposition lanes, not proof that only those cases could ever use UI):

**UI planning / identity, dynamic result, or safe interaction + fixture:** `case-1, 2, 4, 21, 22, 29, 32, 46, 53-61, 80-84, 86-93, 96, 115` (31 cases). Require authorized test identity/session and expected identity/department assertions for 1/2/4; stable known customer/book entries or mockable sandbox for lookup/result behavior; verified selectors and exact expected outcomes; safe fixtures where adding/removing rows or entering values changes UI. Unknown risk must be re-reviewed per actual step, not inherited from workflow label.

**Clarification before a valid assertion:** `case-3, 5, 20, 23, 28, 36, 76, 118, 120, 131, 156` (11). Required evidence is product-owner decision on the disputed rule/input/result (including “本期不做”/feature scope where applicable); for integration questions also the authoritative interface contract. Do not convert unresolved prose into a pass/fail assertion.

**API/integration/backend/data/auth/security:** `case-6-9, 11-15, 17-19, 24-27, 50-52, 56, 62-70, 73-75, 77-79, 85, 97-101, 103-117, 121-130, 132-155` except cases explicitly represented as draft UI partial/candidate still remain blocked for their non-UI clauses. The audit lane’s full API/integration IDs are `case-6-9, 11-15, 17-19, 24-27, 34-35, 37-38, 50-70, 73-75, 77-79, 85, 97-101, 103-114, 116-117, 119, 121-130, 132-150, 154-155` (94). Required evidence: real OpenAPI/endpoint and auth contract; isolated QA base URL; test identities/roles; controlled API mocks or fixtures; known customer/order/book/status records; side-effect-safe creation and cleanup/rollback; readback via API/database/audit/event logs; contract for WeCom/WDT/callback/scheduler behavior. Browser UI cannot establish server remarks, IDs, approval routing, inventory/transactions, latest-vs-cached data, callback semantics, token handling, authorization ownership, or external pushes. Specific subsets: approval/inventory/push/transactions require integration logs and rollback (`6-9, 11-15, 50-70, 73-75, 77-78, 85, 103-117, 119, 124-130, 134-147`); customer/book API/data requirements require contract and controlled fixtures (`17-19, 24-27, 34, 97-101, 108-114, 121-123, 126-130, 132, 136-139`); order/history/status/auth/security require role-separated accounts and existing records plus API/storage evidence (`79, 97-101, 121-130, 140-155`).

**Out of scope / exclude, not pass:** `case-16, 71, 72, 95, 102`. Confirmed deferred/not-in-release functionality. Leave excluded until scope is explicitly changed.

The inventory risk gate separately marks `unknown`: 76 IDs = `case-1-5, 17-18, 20-29, 32, 36, 46, 53-61, 80-84, 86-93, 96-101, 108-115, 121-123, 126-133, 136-139, 148-153, 156`; `irreversible`: 60 IDs = `case-6-9, 11-15, 19, 35, 37-38, 50-52, 56, 62-70, 73-79, 85, 100, 103-107, 113, 116-117, 119-120, 124-125, 134-135, 140-147, 154-155`. The risk label is a coarse gate and demonstrably misclassifies some read-only UI checks; assess the specific proposed action instead. Five precondition-only blockers in prior run were `case-16, 71, 72, 95, 102`.

## Existing false pass / undercoverage findings
- `case-47`: deterministic false pass risk; only disabled submit asserted, missing red invalid region indicator.
- `case-94`: old run asserted title only and missed known mobile clipping; current draft still covers one route, not all three.
- `case-35`: presence of one delete button is not delete behavior or per-row coverage.
- `case-37/38`: text absence/presence does not prove control is fixed or backend default courier behavior.
- `case-52/138`: disabled button alone cannot establish full required/format validation, and no call-count evidence proves “does not call API”.
- `case-133`: visible state cannot establish hidden productId clearing.
- `case-137`: accepted-looking input values alone do not prove successful processing or subtotal.
- Earlier full run reports 9 deterministic vs 7 Computer Use passes and 6 aligned failures. Run’s 141/143 blocked states are non-execution, not product failures. `case-10` is a confirmed shared failure; do not count blocked cases as passes.

## Source artifacts
Project JSON, run JSON/report, blocker audit JSON/Markdown, and the draft JSON named above. This report is a file-only audit; no target-site result was generated.
