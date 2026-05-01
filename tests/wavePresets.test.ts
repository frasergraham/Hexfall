import { describe, expect, it } from "vitest";
import { WAVE_PRESETS, getPreset, presetDefaults, presetMix } from "../src/wavePresets";
import { parseWaveLine } from "../src/waveDsl";

describe("WAVE_PRESETS — every preset is well-formed", () => {
  it("has at least 1 preset", () => {
    expect(WAVE_PRESETS.length).toBeGreaterThan(0);
  });

  it("ids are unique", () => {
    const ids = new Set(WAVE_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(WAVE_PRESETS.length);
  });

  it("every preset's pct weights sum to 100", () => {
    for (const p of WAVE_PRESETS) {
      const sum = Object.values(p.pct).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum, `preset ${p.id} pct sum`).toBe(100);
    }
  });

  it("every preset.build() with default values produces a parseable wave line", () => {
    for (const p of WAVE_PRESETS) {
      const defaults = presetDefaults(p);
      const line = p.build(defaults);
      expect(() => parseWaveLine(line), `preset ${p.id} default build`).not.toThrow();
    }
  });

  it("every preset.build() with min and max values produces parseable wave lines", () => {
    for (const p of WAVE_PRESETS) {
      const lo: Record<string, number> = {};
      const hi: Record<string, number> = {};
      for (const param of p.params) {
        lo[param.id] = param.min;
        hi[param.id] = param.max;
      }
      expect(() => parseWaveLine(p.build(lo)), `${p.id} min`).not.toThrow();
      expect(() => parseWaveLine(p.build(hi)), `${p.id} max`).not.toThrow();
    }
  });
});

describe("getPreset", () => {
  it("returns the preset for a known id", () => {
    const calm = getPreset("calm");
    expect(calm?.name).toBe("Calm");
  });

  it("returns undefined for an unknown id", () => {
    expect(getPreset("nope")).toBeUndefined();
  });
});

describe("presetDefaults", () => {
  it("returns a value for every param at its default", () => {
    for (const p of WAVE_PRESETS) {
      const d = presetDefaults(p);
      for (const param of p.params) {
        expect(d[param.id]).toBe(param.default);
      }
    }
  });
});

describe("presetMix", () => {
  it("returns the preset's pct map", () => {
    const calm = getPreset("calm")!;
    const mix = presetMix(calm);
    expect(mix.normal).toBe(75);
    expect(mix.coin).toBe(25);
  });
});
