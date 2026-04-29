// GoatCounter event reporting. We bypass the loaded `count.js` for events
// because it dedupes repeat calls with the same path inside a single
// browser session (via sessionStorage), which means a player who plays
// several runs in a row only registers one `play-start-*` event. Sending
// directly to the `/count` endpoint with a fresh `rand` on every call
// makes each play count as a distinct event server-side.

const ENDPOINT = "https://twistedweasel.goatcounter.com/count";

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

function isLocal(): boolean {
  // Capacitor iOS serves from capacitor://localhost, and Android from
  // https://localhost — those are real app launches, not dev. Only treat
  // localhost as "dev" when loaded over plain http from a browser.
  const proto = location.protocol;
  if (proto !== "http:" && proto !== "https:") return false;
  const h = location.hostname;
  if (proto === "https:" && h === "localhost") return false;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "" ||
    h.endsWith(".local")
  );
}

function send(path: string, title: string): void {
  if (isLocal()) return;
  try {
    const url = new URL(ENDPOINT);
    url.searchParams.set("p", path);
    url.searchParams.set("t", title);
    url.searchParams.set("e", "true");
    url.searchParams.set("rand", String(Math.random()));
    // Image beacon — fire-and-forget GET, no CORS preflight, no
    // sessionStorage dedup.
    new Image().src = url.toString();
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
