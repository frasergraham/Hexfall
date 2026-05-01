import "./style.css";
import { preloadSfx } from "./audio";
import { Game } from "./game";

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
const overlay = document.getElementById("overlay");
const touchbar = document.getElementById("touchbar");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");

if (!canvas || !overlay || !touchbar || !scoreEl || !bestEl) {
  throw new Error("Missing required DOM nodes");
}

const game = new Game({ canvas, overlay, touchbar, scoreEl, bestEl });
game.start();
preloadSfx();
