# FINDINGS.md

Integration-test investigation findings for `ecoco-customer-servic`.
These are **potential issues discovered while writing tests** — not fixes.
No source code under `services/`, `routes/`, `middleware/` was modified.

---

## F-001 · `extractRiskLevel` does not recognise the English phrasing "risk level: Medium"

**File:** `services/rag.service.js`
**Function:** `extractRiskLevel(text)`
**Regex:** `/(?:風險|risk(?:_level)?)[\s:：-]*(High|Medium|Low)/i`

**Observation:** The pattern matches `風險：High`, `risk: Medium`, and `risk_level: Low`
(because after `risk` it only allows `[\s:：-]*` separators before the level word).
But the natural English form **`risk level: Medium`** contains the extra word `level`
between `risk` and `:`, so the separator class cannot bridge it and the function
silently falls back to `'Low'`.

**Impact:** A knowledge chunk whose content describes risk in English as
`risk level: Medium` would be stored/served with `risk_level = 'Low'`, weakening the
high-risk guardrail (`buildRuntimeGuardrails` / `hasHighRiskChunk`) for that chunk.
Chinese and `risk:`/`risk_level:` forms are unaffected.

**Suggested fix (for the maintainer, not applied here):** extend the regex to also
permit an optional `level` word, e.g.
`/(?:風險|risk(?:\s*level)?)[\s:：-]*(High|Medium|Low)/i`.

**How it was found:** A test originally asserting
`extractRiskLevel('risk level: Medium') === 'Medium'` failed and returned `'Low'`.
Adjusted the test to the supported forms (`risk: Medium`, `risk_level: Low`) and
recorded this instead of changing production code.

**Severity:** Low–Medium (only affects English risk phrasing; Chinese corpus is the primary case).

---

## Notes

- All external services were mocked during testing: the Anthropic client is a stub,
  the LINE reply call is intercepted via a global `fetch` mock, and the OpenAI
  embedding endpoint is intercepted via the same global `fetch` mock. No real network
  requests were made.
- New test files (all under `tests/`): `report.service.test.js`, `rag.service.test.js`,
  `line.routes.test.js`, `chat.routes.test.js`. Existing tests and `evals/` were not
  modified.
- `npm test` result after this work: **113 passed / 0 failed**. `npm run lint`: 41/41 passed.
