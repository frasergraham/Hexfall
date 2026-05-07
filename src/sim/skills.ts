// Pre-baked skill profiles. Hand-picked first pass — calibrate against
// real playtest data before treating absolute scores as ground truth.
// Relative differences between profiles are reliable; absolutes aren't.

import type { SkillProfile } from "./types";

export const SKILLS: ReadonlyArray<SkillProfile> = [
  { name: "novice",  reactionMs: 400, accuracy: 0.55, greed: 0.40, lateralColsPerSec:  6 },
  { name: "casual",  reactionMs: 250, accuracy: 0.75, greed: 0.55, lateralColsPerSec:  8 },
  { name: "skilled", reactionMs: 150, accuracy: 0.90, greed: 0.65, lateralColsPerSec: 10 },
  { name: "expert",  reactionMs:  80, accuracy: 0.97, greed: 0.75, lateralColsPerSec: 12 },
];

export function skillByName(name: string): SkillProfile | undefined {
  return SKILLS.find((s) => s.name === name);
}
