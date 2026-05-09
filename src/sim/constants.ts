// Tunables shared between the endless and challenge run loops.

// Anchor for cluster reaction window in sim time. At medium difficulty,
// score 0, calm phase, no slow/fast active, the cluster spends this
// many seconds in flight before reaching the player band. Speed
// modifiers (cfg.fallSpeedMul × score-ramp × lateGameSpeedMul × wave
// variant × timescale) compress this window proportionally.
export const BASE_REACTION_WINDOW_SEC = 2.5;
