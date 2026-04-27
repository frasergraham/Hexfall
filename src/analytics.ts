// GoatCounter event reporting. The loader script in index.html exposes
// `window.goatcounter`; calls before it loads are dropped silently.

interface GoatCounter {
  count: (vars: { path: string; title?: string; event?: boolean }) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

// Scores are bucketed into 100-wide bins so GoatCounter (which counts
// events by name) gives a usable distribution. Capped at 3000+ to keep
// the set of distinct event names bounded.
const SCORE_BUCKET_SIZE = 100;
const SCORE_BUCKET_CAP = 3000;

function bucketScore(score: number): string {
  if (score >= SCORE_BUCKET_CAP) return `${SCORE_BUCKET_CAP}+`;
  const lo = Math.max(0, Math.floor(score / SCORE_BUCKET_SIZE) * SCORE_BUCKET_SIZE);
  return `${lo}-${lo + SCORE_BUCKET_SIZE}`;
}

function send(path: string, title: string): void {
  const gc = window.goatcounter;
  if (!gc?.count) return;
  try {
    gc.count({ path, title, event: true });
  } catch {
    // Analytics must never break the game.
  }
}

export function trackPlayStart(difficulty: string): void {
  send(`play-start-${difficulty}`, `Play start (${difficulty})`);
}

export function trackPlayEnd(difficulty: string, score: number): void {
  const bucket = bucketScore(score);
  send(
    `play-end-${difficulty}-${bucket}`,
    `Play end (${difficulty}, score ${bucket})`,
  );
}
