import { describe, expect, it } from "vitest";
import {
  axialAdd,
  axialKey,
  axialToPixel,
  buildPolyhexShape,
  neighborsOf,
  NEIGHBOR_DIRS,
  pixelToAxial,
  SHAPES,
  SQRT3,
} from "../src/hex";
import { mulberry32 } from "../src/rng";

describe("axial helpers", () => {
  it("axialKey is stable", () => {
    expect(axialKey({ q: 0, r: 0 })).toBe("0,0");
    expect(axialKey({ q: -3, r: 5 })).toBe("-3,5");
  });

  it("axialAdd sums components", () => {
    expect(axialAdd({ q: 1, r: 2 }, { q: 3, r: 4 })).toEqual({ q: 4, r: 6 });
    expect(axialAdd({ q: -1, r: 1 }, { q: 1, r: -1 })).toEqual({ q: 0, r: 0 });
  });

  it("NEIGHBOR_DIRS has 6 entries summing to (0,0)", () => {
    expect(NEIGHBOR_DIRS).toHaveLength(6);
    const sum = NEIGHBOR_DIRS.reduce(
      (acc, d) => ({ q: acc.q + d.q, r: acc.r + d.r }),
      { q: 0, r: 0 },
    );
    expect(sum).toEqual({ q: 0, r: 0 });
  });

  it("neighborsOf produces 6 distinct adjacent cells", () => {
    const ns = neighborsOf({ q: 0, r: 0 });
    expect(ns).toHaveLength(6);
    const keys = new Set(ns.map(axialKey));
    expect(keys.size).toBe(6);
    // Each is distance 1 in axial.
    for (const n of ns) {
      const dist = (Math.abs(n.q) + Math.abs(n.r) + Math.abs(-n.q - n.r)) / 2;
      expect(dist).toBe(1);
    }
  });
});

describe("axial ↔ pixel round-trip", () => {
  it("axialToPixel for the origin is (0,0) at any size", () => {
    expect(axialToPixel({ q: 0, r: 0 }, 22)).toEqual({ x: 0, y: 0 });
  });

  it("pixelToAxial undoes axialToPixel for integer cells", () => {
    const size = 22;
    for (const cell of [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: -2, r: 3 }]) {
      const p = axialToPixel(cell, size);
      const back = pixelToAxial(p.x, p.y, size);
      // Normalise away the -0 vs +0 distinction that toEqual cares about.
      expect(back.q + 0).toBe(cell.q);
      expect(back.r + 0).toBe(cell.r);
    }
  });

  it("pixel x grows with q (positive q is to the right)", () => {
    const a = axialToPixel({ q: 0, r: 0 }, 10);
    const b = axialToPixel({ q: 1, r: 0 }, 10);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.x).toBeCloseTo(SQRT3 * 10);
  });
});

describe("SHAPES library", () => {
  it("contains shapes of sizes 2, 3, 4, 5", () => {
    const sizes = new Set(SHAPES.map((s) => s.length));
    expect(sizes).toEqual(new Set([2, 3, 4, 5]));
  });

  it("every shape is contiguous (every cell touches another in the shape)", () => {
    for (const shape of SHAPES) {
      const set = new Set(shape.map(axialKey));
      // Skip first cell (the anchor) — others must each have a neighbour
      // already present when added in this order.
      const placed = new Set<string>([axialKey(shape[0]!)]);
      for (let i = 1; i < shape.length; i++) {
        const ns = neighborsOf(shape[i]!).map(axialKey);
        const touches = ns.some((k) => placed.has(k));
        expect(touches).toBe(true);
        placed.add(axialKey(shape[i]!));
      }
      expect(set.size).toBe(shape.length); // no duplicates
    }
  });
});

describe("buildPolyhexShape", () => {
  it("generates the requested cell count", () => {
    for (const n of [1, 2, 3, 5, 8]) {
      expect(buildPolyhexShape(n).length).toBe(n);
    }
  });

  it("returns a connected blob (each cell adjacent to a previous one)", () => {
    const shape = buildPolyhexShape(7, mulberry32(123));
    const placed = new Set<string>([axialKey(shape[0]!)]);
    for (let i = 1; i < shape.length; i++) {
      const ns = neighborsOf(shape[i]!).map(axialKey);
      expect(ns.some((k) => placed.has(k))).toBe(true);
      placed.add(axialKey(shape[i]!));
    }
  });

  it("is deterministic under a seeded RNG", () => {
    const a = buildPolyhexShape(6, mulberry32(42));
    const b = buildPolyhexShape(6, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("yields varied shapes from different seeds", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 20; s++) {
      const shape = buildPolyhexShape(5, mulberry32(s));
      seen.add(JSON.stringify(shape));
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});
