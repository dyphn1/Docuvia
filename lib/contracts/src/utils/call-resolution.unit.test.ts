import { describe, it, expect } from "vitest";
import {
  aggregateCallResolution,
  callResolutionDenominator,
} from "./call-resolution.js";

describe("aggregateCallResolution", () => {
  it("returns a zeroed aggregate for an empty map", () => {
    expect(aggregateCallResolution({})).toEqual({
      total: 0,
      resolved: 0,
      selfDiscarded: 0,
      unresolved: 0,
      unresolvable: 0,
      external: 0,
      unknownReceiver: 0,
    });
  });

  it("sums every counter across files, defaulting absent optional buckets to 0 (pre-#192/#230 producers)", () => {
    expect(
      aggregateCallResolution({
        "a.ts": { total: 3, resolved: 1, selfDiscarded: 1, unresolved: 1 },
        "b.ts": {
          total: 2,
          resolved: 2,
          selfDiscarded: 0,
          unresolved: 0,
          unresolvable: 4,
        },
      }),
    ).toEqual({
      total: 5,
      resolved: 3,
      selfDiscarded: 1,
      unresolved: 1,
      unresolvable: 4,
      external: 0,
      unknownReceiver: 0,
    });
  });

  it("sums the issue #230 external / unknownReceiver buckets", () => {
    expect(
      aggregateCallResolution({
        "a.ts": {
          total: 10,
          resolved: 2,
          selfDiscarded: 1,
          unresolved: 1,
          unresolvable: 1,
          external: 4,
          unknownReceiver: 1,
        },
        "b.ts": {
          total: 6,
          resolved: 1,
          selfDiscarded: 0,
          unresolved: 0,
          unresolvable: 0,
          external: 3,
          unknownReceiver: 2,
        },
      }),
    ).toEqual({
      total: 16,
      resolved: 3,
      selfDiscarded: 1,
      unresolved: 1,
      unresolvable: 1,
      external: 7,
      unknownReceiver: 3,
    });
  });
});

describe("callResolutionDenominator", () => {
  it("subtracts every structural bucket, leaving only sites Tier A should resolve", () => {
    expect(
      callResolutionDenominator({
        total: 100,
        resolved: 20,
        selfDiscarded: 5,
        unresolved: 10,
        unresolvable: 15,
        external: 40,
        unknownReceiver: 10,
      }),
    ).toBe(30);
  });

  it("treats absent optional buckets as 0, so pre-#192/#230 stats keep their old denominator", () => {
    expect(
      callResolutionDenominator({
        total: 10,
        resolved: 4,
        selfDiscarded: 2,
        unresolved: 4,
      }),
    ).toBe(8);
  });

  it("never counts an external or unknown-receiver site as a resolution failure", () => {
    // The whole point of issue #230: a file of nothing but `expect()` and `arr.push()` calls is
    // not a 0%-resolution file, it is a file with no resolvable call sites at all.
    const allStructural = {
      total: 50,
      resolved: 0,
      selfDiscarded: 0,
      unresolved: 0,
      unresolvable: 10,
      external: 30,
      unknownReceiver: 10,
    };
    expect(callResolutionDenominator(allStructural)).toBe(0);
  });
});
