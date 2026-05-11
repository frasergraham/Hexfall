// Bucketed object pool for FallingCluster instances. Endless / challenge
// spawns at late-game cadence (1-3/sec) build a fresh Matter compound
// body each time, which allocates ~50-100 heap objects per spawn — the
// heaviest being the Vector arrays inside each polygon part. That churn
// is the main remaining source of GC hitches after the Phase 1 render
// changes; pooling lets us reuse a body whose vertices / axes / mass
// properties are already correct for the requested polyhex shape, only
// resetting position / velocity / angle / kind / lifecycle flags.
//
// Bucketing is by shape signature + hexSize. hexSize is constant for a
// run, so in practice this reduces to one bucket per polyhex shape
// (~14 in SHAPES) with a small entry cap each — total retained memory
// stays well under half a megabyte.
//
// The world reference is injected so acquire/release can rehook
// bodies in and out of Matter's composite. Pool is intentionally not
// shared across runs: Game.resetWorld() / resize / DPR change call
// clear() so the next run starts cold.
//
// Kill switch: `?pool=0` in the URL bypasses the pool entirely
// (acquire builds fresh, release drops). Useful if a Matter weirdness
// shows up in TestFlight without redeploying.

import { Composite, type World } from "matter-js";
import { FallingCluster, type SpawnOpts } from "./cluster";
import type { Shape } from "./types";

const PER_BUCKET_CAP = 8;

function shapeKey(shape: Shape, hexSize: number): string {
  // Stable string from the polyhex cells. SHAPES entries are authored
  // in a fixed order, so a direct stringify is sufficient — we don't
  // need to canonicalise sort order.
  let s = `${hexSize}`;
  for (const c of shape) s += `|${c.q},${c.r}`;
  return s;
}

export class ClusterPool {
  private world: World;
  private buckets = new Map<string, FallingCluster[]>();
  private enabled = true;

  constructor(world: World, enabled = true) {
    this.world = world;
    this.enabled = enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  // Borrow a cluster for `opts.kind` at (x, y) with the given initial
  // motion. If a matching body is in the bucket it's reset in place
  // and re-added to the world; otherwise we fall through to the
  // existing FallingCluster.spawn() construction path.
  acquire(opts: SpawnOpts): FallingCluster {
    const key = shapeKey(opts.shape, opts.hexSize);
    let cluster: FallingCluster | undefined;
    if (this.enabled) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.length > 0) {
        cluster = bucket.pop()!;
        cluster.reset(opts);
      }
    }
    if (!cluster) cluster = FallingCluster.spawn(opts);
    Composite.add(this.world, cluster.body);
    return cluster;
  }

  // Return a cluster to its bucket. Caller must have already removed
  // the body from the world; we don't double-remove because the cleanup
  // filter sites already do it inline as part of their existing pass.
  release(cluster: FallingCluster): void {
    if (!this.enabled) return;
    const key = shapeKey(cluster.shape, cluster.hexSize);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    // Drop the spillover and let GC reap it — the cap is the safety
    // valve against pathological wave compositions that briefly spawn
    // hundreds of single-hex clusters and would otherwise retain them
    // all in memory for the rest of the session.
    if (bucket.length >= PER_BUCKET_CAP) return;
    cluster.hintLabel = null;
    bucket.push(cluster);
  }

  // Drop all retained bodies. Called on resize (hexSize may change),
  // on full world reset, and when the kill switch flips off. Bodies
  // sitting in buckets are already detached from the world, so we just
  // let GC reap them — no Composite.remove needed.
  clear(): void {
    this.buckets.clear();
  }
}
