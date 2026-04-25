import type { InputAction } from "./types";

export type InputHandler = (action: InputAction, pressed: boolean) => void;

const KEY_MAP: Record<string, InputAction> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  KeyQ: "rotateCcw",
  KeyZ: "rotateCcw",
  KeyE: "rotateCw",
  KeyX: "rotateCw",
  Space: "confirm",
  Enter: "confirm",
  KeyP: "pause",
};

export function bindInput(
  touchbar: HTMLElement,
  handler: InputHandler,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (e.repeat) return;
    e.preventDefault();
    handler(action, true);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    handler(action, false);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const buttons = touchbar.querySelectorAll<HTMLButtonElement>("[data-action]");
  const cleanups: Array<() => void> = [];

  buttons.forEach((btn) => {
    const action = btn.dataset.action as InputAction | undefined;
    if (!action) return;

    const press = (e: Event) => {
      e.preventDefault();
      btn.classList.add("pressed");
      handler(action, true);
    };
    const release = (e: Event) => {
      e.preventDefault();
      btn.classList.remove("pressed");
      handler(action, false);
    };

    btn.addEventListener("touchstart", press, { passive: false });
    btn.addEventListener("touchend", release, { passive: false });
    btn.addEventListener("touchcancel", release, { passive: false });
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);

    cleanups.push(() => {
      btn.removeEventListener("touchstart", press);
      btn.removeEventListener("touchend", release);
      btn.removeEventListener("touchcancel", release);
      btn.removeEventListener("mousedown", press);
      btn.removeEventListener("mouseup", release);
      btn.removeEventListener("mouseleave", release);
    });
  });

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    cleanups.forEach((c) => c());
  };
}

export function isTouchDevice(): boolean {
  return "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
}
