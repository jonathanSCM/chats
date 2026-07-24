import { describe, it, expect } from "vitest";
import { computeUsage } from "./subscription";

describe("computeUsage", () => {
  it("sums CONSUMED records against the plan limit", () => {
    const result = computeUsage(
      [
        { type: "CONSUMED", quantity: 1 },
        { type: "CONSUMED", quantity: 1 },
        { type: "CONSUMED", quantity: 1 },
      ],
      1000,
    );
    expect(result).toEqual({ consumed: 3, allowed: 1000, extra: 0 });
  });

  it("adds EXTRA_PURCHASE quantities on top of the plan limit", () => {
    const result = computeUsage(
      [
        { type: "CONSUMED", quantity: 950 },
        { type: "EXTRA_PURCHASE", quantity: 200 },
      ],
      1000,
    );
    expect(result).toEqual({ consumed: 950, allowed: 1200, extra: 200 });
  });

  it("returns zeros when there are no records", () => {
    expect(computeUsage([], 200)).toEqual({ consumed: 0, allowed: 200, extra: 0 });
  });

  it("reports consumed >= allowed once the limit is reached (used for the block check)", () => {
    const result = computeUsage([{ type: "CONSUMED", quantity: 200 }], 200);
    expect(result.consumed >= result.allowed).toBe(true);
  });
});
