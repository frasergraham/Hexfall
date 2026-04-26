export type Axial = { q: number; r: number };

export type ClusterKind = "normal" | "sticky" | "slow" | "fast" | "coin";

export type Shape = Axial[];

export type GameState = "menu" | "playing" | "paused" | "gameover";

export type InputAction =
  | "left"
  | "right"
  | "rotateCw"
  | "rotateCcw"
  | "confirm"
  | "pause";

// Custom labels we attach to Matter bodies so collision handlers can route.
export type BodyTag = "player" | "cluster" | "debris" | "wall";
