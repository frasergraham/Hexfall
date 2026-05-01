// Editor field-help glyph. Each `(i)` button next to a label opens a
// small popup with the help string for that field. Click again (or
// click another button) to close. The body is hidden via the `hidden`
// attribute so CSS animation can re-enable it on toggle.
//
// FIELD_HELP is the canonical map keyed by the editor's field names;
// `helpTipHtml` returns either the popup markup or an empty string when
// the key has no entry. Caller can override the text per-call.

import { escapeHtml } from "../escape";
import { MAX_CUSTOM_NAME_LEN } from "../../customChallenges";

export const FIELD_HELP: Record<string, string> = {
  // Wave dialog (advanced + presets share keys where applicable).
  sizeMin: "Smallest cluster size that can spawn (1 = single hex, 5 = giant blob).",
  sizeMax: "Largest cluster size that can spawn.",
  speed: "Cluster fall-speed multiplier. 1.0 = base, 2.0 = double speed.",
  rate: "How many blocks fall per 10 seconds. Higher = denser wave.",
  slotRate: "Seconds between slot-stream spawns (only for slot-pattern waves).",
  count: "Maximum probabilistic spawns. Wave ends after this many. Blank = no cap.",
  dur: "Hard time limit in seconds. Wave ends when timer expires. Blank = none.",
  walls: "Wall configuration: pinch (red panels), zigzag (sinusoidal), narrow (tight corridor).",
  wallAmp: "Amplitude of zigzag walls (0 = flat, 0.5 = max curve).",
  wallPeriod: "Period of zigzag walls (higher = wider waves).",
  safeCol: "Column kept clear of normal spawns. random = picks one each play, none = no enforcement.",
  origin: "Where clusters enter from. top = above, topAngled = above with tilt, side = horizontal entry.",
  dir: "Tilt angle applied to every spawn. Negative leans left, positive leans right.",
  dirRandom: "Randomise tilt per spawn within ±Tilt instead of using a fixed bias.",
  pct: "Probability weight per cluster kind. Numbers are relative to each other.",
  amp: "Amplitude of the zigzag walls (0 = flat, 0.5 = max curve).",
  // Settings dialog.
  difficulty: "Visual difficulty rating shown on the challenge card. 1 = easy, 5 = hardest.",
  slowDuration: "Seconds of 0.5x time after picking up a SLOW block.",
  fastDuration: "Seconds of 1.25x time + bonus pool after picking up a FAST block.",
  shieldDuration: "Seconds of bubble protection after picking up a SHIELD block.",
  droneDuration: "Seconds the drone sentinel stays active after pickup.",
  dangerSize: "How big your blob can grow before the danger glow appears and the next blue hit ends the run. Lower = harder.",
  starOne: "Score required for 1 star.",
  starTwo: "Score required for 2 stars.",
  starThree: "Score required for 3 stars.",
  starsAuto: "Auto-suggest computes stars from your wave content. Adjust afterwards if you like.",
  // Edit screen.
  name: `Display name for your challenge (max ${MAX_CUSTOM_NAME_LEN} characters).`,
  seed: "RNG seed. The same seed produces the same cluster sequence on every replay.",
};

export function helpTipHtml(key: string, override?: string): string {
  const text = override ?? FIELD_HELP[key];
  if (!text) return "";
  return `<span class="editor-help-wrap">
    <button type="button" class="editor-help-btn" data-action="editor-toggle-help" aria-label="Help">i</button>
    <span class="editor-help-text" hidden>${escapeHtml(text)}</span>
  </span>`;
}
