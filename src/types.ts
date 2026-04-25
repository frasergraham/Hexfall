export type Axial = { q: number; r: number };

export type ClusterKind = "normal" | "sticky";

export type Shape = Axial[];

export type GameState = "menu" | "playing" | "paused" | "gameover";

export type InputAction =
  | "left"
  | "right"
  | "rotateCw"
  | "rotateCcw"
  | "confirm"
  | "pause";
