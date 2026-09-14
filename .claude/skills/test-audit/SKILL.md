---
name: test-audit
description: Audits tests on two independent axes: functional-category coverage and 3A content-verification honesty. Use when strengthening tests, reviewing test quality, or validating launch-gate evidence.
---

# Test Audit — Coverage Shape + 3A Honesty

## Purpose

A green suite can still be wrong in two different ways:

1. **The right kind of test never existed.** A feature may have happy-path tests but no invalid-input, error-handling, stress, or persisted state-diff evidence.
2. **The test exists but proves too little.** Weak assertions such as `toBeDefined()` can pass while values, fields, or persisted state are wrong.

Treat these as independent axes. Do not convert category coverage into the #371 contract-quality score, and do not convert #192 precision/recall/F1 into test coverage.

The full category/tier rules are defined in `references/test-standard.md`.

## Axis 1 — Functional category coverage

Canonical markers:

- `[happy]`
- `[invalid-input]`
- `[error-handling]`
- `[stress]`
- `[state-diff]`

Run the deterministic scanner:

```bash
bash .claude/skills/test-audit/scripts/category-scan.sh
```

Write machine-readable evidence when needed:

```bash
bash .claude/skills/test-audit/scripts/category-scan.sh \
  --json-out /tmp/test-category.json
```

The report ends with `FAIL_COUNT=N`. CI does **not** trust a historical hand-entered baseline: `scripts/test-category-ratchet.sh` re-scans the exact base and HEAD and rejects only increases while legacy debt is being reduced.

When adding or strengthening a test, prefer a real category test over a label-only edit. In particular, `[state-diff]` must assert exact before/after persisted or externally visible state.

## Axis 2 — 3A content verification

### P0 — High risk

| Pattern | Problem | Preferred replacement |
| --- | --- | --- |
| `toBeDefined()` | proves only existence | exact `toEqual(...)`, `toHaveProperty(key, value)`, or exact type/value |
| `toBeUndefined()` | proves only absence | exact result shape or explicit null/absence contract |
| `toBeTruthy()` / `toBeFalsy()` | loses type/value information | exact boolean/value assertion |

### P1 — Medium risk

| Pattern | Problem | Preferred replacement |
| --- | --- | --- |
| `toHaveBeenCalled()` | args may be wrong | `toHaveBeenCalledWith(...)` |
| `toHaveBeenCalledTimes(n)` only | proves count, not content | verify exact args/result too |
| `not.toHaveBeenCalled()` only | does not prove alternative behavior | assert the intended result/path |

### P2 — Low risk

| Pattern | Problem | Preferred replacement |
| --- | --- | --- |
| `toBeGreaterThan(0)` | only proves positive | exact count / exact collection |
| `arrayContaining(...)` only | extra unexpected items still pass | pair with exact length/shape |

## Audit procedure

1. Run the category scanner and record missing category classes by tier.
2. Scan for weak assertions:

   ```bash
   rg -n "toBeDefined\(\)|toBeUndefined\(\)|toBeTruthy\(\)|toBeFalsy\(\)|toBeGreaterThan\(0\)" \
     --type ts -g "*.test.ts" -g "*.spec.ts"
   ```

3. For every finding, identify the authoritative source/contract and the silent-failure mode.
4. Add the smallest missing behavioral category with exact assertions.
5. Re-run identical inputs where determinism matters.
6. Re-run both repository gates:

   ```bash
   bash scripts/test-quality-gate.sh
   ```

## Priority order

1. persistence/integration tests — real DB/files/process boundaries and `[state-diff]` evidence;
2. workflows — input/output/error/state propagation across orchestration layers;
3. services/core logic;
4. mock-heavy utilities.

## Example — weak vs strong

Weak:

```typescript
it("[happy] returns blast radius", () => {
  const result = impactService.getBlastRadius(store, "target");
  expect(result).toBeDefined();
  expect(result.length).toBeGreaterThan(0);
});
```

Strong:

```typescript
it("[happy] returns the exact dependent set", () => {
  const result = impactService.getBlastRadius(store, "target");
  expect(result).toEqual([{ name: "caller", type: "module" }]);
});
```

A `5/5` category file can still fail Axis 2 or #371 mandatory gates. Category labels are coverage-shape evidence, not proof of correctness.