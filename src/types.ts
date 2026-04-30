export type Axial = { q: number; r: number };

export type ClusterKind =
  | "normal"
  | "sticky"
  | "slow"
  | "fast"
  | "coin"
  | "shield"
  | "drone"
  | "tiny"
  | "big";

export type Shape = Axial[];

export type GameState =
  | "menu"
  | "challengeSelect"
  | "challengeIntro"
  | "playing"
  | "paused"
  | "gameover"
  | "challengeComplete"
  | "unlockShop"
  | "blocksGuide"
  | "editorHome"
  | "editorEdit";

export type GameMode = "endless" | "challenge";

export type Difficulty = "easy" | "medium" | "hard" | "hardcore";

export type WallKind = "none" | "pinch" | "zigzag" | "narrow";

export type InputAction =
  | "left"
  | "right"
  | "rotateCw"
  | "rotateCcw"
  | "confirm"
  | "pause";

// Custom labels we attach to Matter bodies so collision handlers can route.
export type BodyTag = "player" | "cluster" | "debris" | "wall";
