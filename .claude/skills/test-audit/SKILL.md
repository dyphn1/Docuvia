---
name: test-audit
description: Audits test files against 3A content-verification standards, flagging weak assertions that don't verify correctness. Use when strengthening tests, reviewing test quality, or checking if tests actually validate data structures.
---

# Test Audit — 3A Content Verification

## Purpose

Scan test files and flag assertions that verify **existence** rather than **correctness**. These "weak assertions" pass even when the code under test silently returns wrong data, drops fields, or degrades to an empty result.

## When to Use

- Before merging a PR with test changes
- When strengthening a test suite
- When reviewing test coverage beyond line-count
- When a feature is reported as "tests pass but doesn't work"

## Weak Assertion Patterns (Priority-Ordered)

### P0 — High Risk (data can be wrong, test still passes)

| Pattern                     | Problem                                              | Replacement                                                            |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `expect(x).toBeDefined()`   | Passes for `""`, `0`, `false`, `[]`, `{}`            | `expect(x).toEqual(expectedValue)`                                     |
| `expect(x).toBeUndefined()` | Only proves absence, not what should be there        | `expect(x).toBeNull()` or `expect(result).toEqual({...without field})` |
| `expect(x).toBeTruthy()`    | Passes for any truthy value — `1`, `"x"`, `[]`, `{}` | `expect(x).toBe(true)` or `expect(x).toEqual(expected)`                |
| `expect(x).toBeFalsy()`     | Passes for `0`, `""`, `null`, `undefined`, `false`   | `expect(x).toBe(false)` or `expect(x).toBeNull()`                      |

### P1 — Medium Risk (mock called but wrong args/return)

| Pattern                                | Problem                                         | Replacement                                      |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `expect(spy).toHaveBeenCalled()`       | Doesn't check arguments                         | `expect(spy).toHaveBeenCalledWith(expectedArgs)` |
| `expect(spy).toHaveBeenCalledTimes(n)` | Doesn't check what was called with              | Add `toHaveBeenCalledWith` alongside             |
| `expect(spy).not.toHaveBeenCalled()`   | Only proves non-call, not what happened instead | Verify the alternative path's result             |

### P2 — Low Risk (numeric/existence checks)

| Pattern                                            | Problem                                     | Replacement                               |
| -------------------------------------------------- | ------------------------------------------- | ----------------------------------------- |
| `expect(x).toBeGreaterThan(0)`                     | Only proves positive, not the actual value  | `expect(x).toBe(expectedCount)`           |
| `expect(x.length).toBeGreaterThan(0)`              | Same as above                               | `expect(x).toHaveLength(expected)`        |
| `expect(x).toEqual(expect.arrayContaining([...]))` | Partial match — extra unexpected items pass | Add `expect(x).toHaveLength(n)` alongside |

## Audit Procedure

### Step 1: Scan for weak assertions

```bash
# Find all weak assertion patterns in test files
rg -n "toBeDefined\(\)|toBeUndefined\(\)|toBeTruthy\(\)|toBeFalsy\(\)|toBeGreaterThan\(0\)" --type ts -g "*.test.ts" -g "*.spec.ts"
```

### Step 2: Classify by risk

For each match, determine:

1. **What is being tested?** (mock call vs real data vs workflow result)
2. **What could go wrong silently?** (field drop, wrong value, empty result)
3. **Is there a real assertion nearby?** (sometimes `toBeDefined` is followed by `toEqual` — the `toBeDefined` is redundant but harmless)

### Step 3: Prioritize strengthening

Focus on:

1. **Workflow tests** (`*-workflow.unit.test.ts`) — these verify data flowing through the orchestration layer
2. **Integration tests** (`*.integration.test.ts`) — these verify real DB/file/network behavior
3. **Service tests** (`*.service.unit.test.ts`) — these verify core business logic
4. **Mock-heavy tests** — where `toHaveBeenCalled` without `toHaveBeenCalledWith` means the test proves nothing about correctness

### Step 4: Strengthen

For each weak assertion, apply the replacement pattern. When strengthening:

1. **Verify the full data structure** — use `toEqual` with the complete expected object
2. **Verify field existence AND value** — `toHaveProperty("field", value)` not just `toHaveProperty("field")`
3. **Verify array lengths** — `toHaveLength(n)` not just `toBeGreaterThan(0)`
4. **Verify no extra fields** — check `Object.keys(result)` matches expected shape
5. **Verify mock arguments** — `toHaveBeenCalledWith` with the exact expected args

## Output Format

```
## Test Audit Report

### Summary
- Files scanned: N
- Weak assertions found: N
- P0 (high risk): N
- P1 (medium risk): N
- P2 (low risk): N

### P0 — High Risk (fix first)
| File | Line | Pattern | Fix |
|------|------|---------|-----|
| foo.test.ts:42 | `toBeDefined()` | Replace with `toEqual(expectedValue)` |

### P1 — Medium Risk
| File | Line | Pattern | Fix |
|------|------|---------|-----|

### P2 — Low Risk
| File | Line | Pattern | Fix |
|------|------|---------|-----|
```

## Examples

### Before (weak)

```typescript
it("returns blast radius", () => {
  const result = impactService.getBlastRadius(store, "target");
  expect(result).toBeDefined();
  expect(result.length).toBeGreaterThan(0);
});
```

### After (strong)

```typescript
it("returns blast radius with correct structure", () => {
  const result = impactService.getBlastRadius(store, "target");
  expect(result).toEqual([{ name: "caller", type: "module" }]);
  expect(result).toHaveLength(1);
});
```

### Before (mock-only)

```typescript
it("calls the service", async () => {
  await workflow.execute("target");
  expect(service.getBlastRadius).toHaveBeenCalled();
});
```

### After (verifies data)

```typescript
it("calls the service and returns correct result", async () => {
  const result = await workflow.execute("target");
  expect(service.getBlastRadius).toHaveBeenCalledWith(store, "target");
  expect(result).toEqual({
    blastRadius: [{ name: "caller", type: "module" }],
    riskLevel: "MEDIUM",
  });
});
```

## Integration with CI

Add to pre-push hook or CI:

```bash
# Count weak assertions — fail if count increases
WEAK_COUNT=$(rg -c "toBeDefined\(\)|toBeUndefined\(\)|toBeTruthy\(\)|toBeFalsy\(\)" --type ts -g "*.test.ts" | awk -F: '{sum+=$2} END {print sum}')
echo "Weak assertions: $WEAK_COUNT"
```
