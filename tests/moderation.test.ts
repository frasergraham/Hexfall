import { describe, expect, it } from "vitest";
import { checkName } from "../src/moderation";

describe("moderation.checkName", () => {
  it("accepts ordinary challenge names", () => {
    for (const name of ["Boogers", "First Drops", "Long Haul", "abcdefg"]) {
      expect(checkName(name).ok).toBe(true);
    }
  });

  it("rejects names that are too short", () => {
    expect(checkName("").ok).toBe(false);
    expect(checkName("a").ok).toBe(false);
    expect(checkName("  ").ok).toBe(false);
    expect(checkName(" a ").ok).toBe(false); // trims to "a"
  });

  it("rejects names that are too long (>36 chars)", () => {
    const long = "x".repeat(37);
    const r = checkName(long);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("too_long");
  });

  it("accepts a name exactly at the 36-char limit", () => {
    const ok = "x".repeat(36);
    expect(checkName(ok).ok).toBe(true);
  });

  it("rejects names containing banned substrings", () => {
    expect(checkName("super fuck").ok).toBe(false);
    expect(checkName("nazi raid").ok).toBe(false);
    expect(checkName("hello shitstorm").ok).toBe(false);
  });

  it("normalises leetspeak when checking bans", () => {
    expect(checkName("fck").ok).toBe(true); // "fck" doesn't include vowel
    expect(checkName("fuc4").ok).toBe(true); // "fuca" — not in word list
    expect(checkName("fu5h").ok).toBe(true);
    expect(checkName("fuck").ok).toBe(false);
    expect(checkName("FUCK").ok).toBe(false);
    expect(checkName("Fück").ok).toBe(false); // diacritic strip
    expect(checkName("f.u.c.k").ok).toBe(false); // punctuation strip
  });

  it("rejects control characters and zero-width joiners", () => {
    const withZwsp = "hello​world"; // zero-width space (in BiDi range)
    expect(checkName(withZwsp).ok).toBe(false);
  });
});
