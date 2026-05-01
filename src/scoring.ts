// Pure scoring helpers. Phase 1.4 (partial) of the refactor: only
// milestone detection has been extracted so far. The fast/big bonus
// pool math is more deeply intertwined with effect timers and audio
// cues; that part lands when EffectsManager moves out (Phase 3.2).

export interface ScoreMilestone {
  threshold: number;
  id: string;
}

export interface MilestoneStepResult<TId = string> {
  /** New cursor position into the milestones array. Pass back in next call. */
  nextIdx: number;
  /** Milestone ids the player just crossed (in threshold-ascending order). */
  awarded: TId[];
}

// Walk the milestone list from `startIdx` and award everything the
// player has crossed at the current `score`. Pure: returns what
// changed instead of mutating. Caller fires the actual side effects
// (achievement reports, banner queue, etc.) for each awarded id.
export function stepMilestones<T extends ScoreMilestone>(
  score: number,
  milestones: ReadonlyArray<T>,
  startIdx: number,
): MilestoneStepResult<T["id"]> {
  let idx = startIdx;
  const awarded: T["id"][] = [];
  while (idx < milestones.length) {
    const m = milestones[idx]!;
    if (score < m.threshold) break;
    awarded.push(m.id);
    idx += 1;
  }
  return { nextIdx: idx, awarded };
}

// Highest bonus-pool tier the player just crossed when banking
// `banked` points. Returns null when the bank is below every tier
// or when the largest tier had already been hit on a previous bank.
// Caller tracks "already awarded" state externally.
export function highestTierCrossed<T extends ScoreMilestone>(
  banked: number,
  tiers: ReadonlyArray<T>,
): T["id"] | null {
  for (let i = tiers.length - 1; i >= 0; i--) {
    if (banked >= tiers[i]!.threshold) return tiers[i]!.id;
  }
  return null;
}
