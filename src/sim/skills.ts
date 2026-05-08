// Pre-baked skill profiles. Calibrated against the user's real-world
// target: a novice on Easy should land in the low-hundreds median.
//
// "novice" = a casual mobile-game adult who's never played HexRain but
// has played other arcade games. Decent thumb-eye coordination, slow
// to commit to dodges, only chases obvious pickups.
// "casual" = a regular player who's done a handful of runs.
// "skilled" = comfortable with the genre, reads queue ahead.
// "expert" = practiced, near-optimal on calm phases.

import type { SkillProfile } from "./types";

export const SKILLS: ReadonlyArray<SkillProfile> = [
  { name: "novice",  reactionMs: 320, accuracy: 0.72, greed: 0.55, lateralColsPerSec:  9 },
  { name: "casual",  reactionMs: 220, accuracy: 0.85, greed: 0.65, lateralColsPerSec: 11 },
  { name: "skilled", reactionMs: 150, accuracy: 0.91, greed: 0.75, lateralColsPerSec: 12 },
  { name: "expert",  reactionMs: 110, accuracy: 0.95, greed: 0.85, lateralColsPerSec: 13 },
];

export function skillByName(name: string): SkillProfile | undefined {
  return SKILLS.find((s) => s.name === name);
}
