import { describe, expect, it } from "vitest";
import { highestTierCrossed, stepMilestones, type ScoreMilestone } from "../src/scoring";

const TIERS: ScoreMilestone[] = [
  { threshold: 200, id: "score200" },
  { threshold: 400, id: "score400" },
  { threshold: 600, id: "score600" },
  { threshold: 800, id: "score800" },
  { threshold: 1000, id: "score1000" },
  { threshold: 1500, id: "score1500" },
];

describe("stepMilestones", () => {
  it("awards nothing below the first threshold", () => {
    expect(stepMilestones(199, TIERS, 0)).toEqual({ nextIdx: 0, awarded: [] });
  });

  it("awards one milestone when score barely crosses it", () => {
    expect(stepMilestones(200, TIERS, 0)).toEqual({ nextIdx: 1, awarded: ["score200"] });
  });

  it("awards multiple milestones in one call (catches up)", () => {
    expect(stepMilestones(601, TIERS, 0)).toEqual({
      nextIdx: 3,
      awarded: ["score200", "score400", "score600"],
    });
  });

  it("respects startIdx so already-awarded milestones aren't re-fired", () => {
    expect(stepMilestones(601, TIERS, 2)).toEqual({
      nextIdx: 3,
      awarded: ["score600"],
    });
  });

  it("awards everything for a runaway score", () => {
    expect(stepMilestones(99999, TIERS, 0).awarded).toHaveLength(TIERS.length);
  });

  it("returns nextIdx unchanged when score hasn't moved", () => {
    expect(stepMilestones(199, TIERS, 0).nextIdx).toBe(0);
    expect(stepMilestones(400, TIERS, 2).nextIdx).toBe(2);
  });

  it("handles an empty milestone list", () => {
    expect(stepMilestones(99999, [], 0)).toEqual({ nextIdx: 0, awarded: [] });
  });
});

describe("highestTierCrossed", () => {
  it("returns null below the lowest threshold", () => {
    expect(highestTierCrossed(199, TIERS)).toBe(null);
  });

  it("returns the highest tier the value clears", () => {
    expect(highestTierCrossed(200, TIERS)).toBe("score200");
    expect(highestTierCrossed(599, TIERS)).toBe("score400");
    expect(highestTierCrossed(1000, TIERS)).toBe("score1000");
    expect(highestTierCrossed(99999, TIERS)).toBe("score1500");
  });

  it("handles an empty tier list", () => {
    expect(highestTierCrossed(99, [])).toBe(null);
  });
});
