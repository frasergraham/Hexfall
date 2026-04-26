import type { InputAction } from "./types";

export type InputHandler = (action: InputAction, pressed: boolean) => void;
export type RotateHandler = (angle: number | null) => void;
export type SlideHandler = (value: number | null) => void;

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

// Bind tap-anywhere-on-canvas as a rotate gesture. The wheel element is
// positioned absolutely INSIDE the canvas's offset parent (e.g. .stage).
// On touchstart it appears centred at the finger; on touchmove the
// callback receives the angle from the anchor (touchstart point) to the
// current touch, and the knob is drawn on the rim at that angle. On
// release the wheel hides and the callback fires with null.
export function bindCanvasWheel(
  surface: HTMLElement,
  wheel: HTMLElement,
  knob: HTMLElement,
  onRotate: RotateHandler,
): () => void {
  let active = false;
  let activeTouchId: number | null = null;
  let anchorX = 0;
  let anchorY = 0;

  // Position values are in the wheel's local coordinate space, where
  // (left, top) is the centre because the wheel uses negative margins.
  const WHEEL_RADIUS = 48; // matches CSS width/2
  const KNOB_HALF = 11;

  const positionWheelAt = (clientX: number, clientY: number) => {
    const rect = surface.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    wheel.style.left = `${localX}px`;
    wheel.style.top = `${localY}px`;
    anchorX = clientX;
    anchorY = clientY;
  };

  const setKnob = (angleFromAnchor: number) => {
    const r = WHEEL_RADIUS - KNOB_HALF;
    const cx = WHEEL_RADIUS;
    const cy = WHEEL_RADIUS;
    knob.style.left = `${cx + Math.cos(angleFromAnchor) * r}px`;
    knob.style.top = `${cy + Math.sin(angleFromAnchor) * r}px`;
  };

  const computeAngle = (clientX: number, clientY: number): number => {
    const dx = clientX - anchorX;
    const dy = clientY - anchorY;
    if (dx === 0 && dy === 0) return -Math.PI / 2;
    return Math.atan2(dy, dx);
  };

  const start = (clientX: number, clientY: number) => {
    active = true;
    positionWheelAt(clientX, clientY);
    setKnob(-Math.PI / 2); // reset knob to top of wheel
    wheel.classList.add("show");
    onRotate(computeAngle(clientX, clientY));
  };
  const move = (clientX: number, clientY: number) => {
    if (!active) return;
    const angle = computeAngle(clientX, clientY);
    setKnob(angle);
    onRotate(angle);
  };
  const end = () => {
    if (!active) return;
    active = false;
    activeTouchId = null;
    wheel.classList.remove("show");
    onRotate(null);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (active) return; // already tracking — ignore additional fingers here
    const t = e.changedTouches[0];
    if (!t) return;
    e.preventDefault();
    activeTouchId = t.identifier;
    start(t.clientX, t.clientY);
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!active || activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]!;
      if (t.identifier === activeTouchId) {
        e.preventDefault();
        move(t.clientX, t.clientY);
        break;
      }
    }
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!active || activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i]!.identifier === activeTouchId) {
        e.preventDefault();
        end();
        break;
      }
    }
  };
  const onMouseDown = (e: MouseEvent) => {
    if (active) return;
    e.preventDefault();
    start(e.clientX, e.clientY);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (active) move(e.clientX, e.clientY);
  };
  const onMouseUp = () => end();

  surface.addEventListener("touchstart", onTouchStart, { passive: false });
  surface.addEventListener("touchmove", onTouchMove, { passive: false });
  surface.addEventListener("touchend", onTouchEnd, { passive: false });
  surface.addEventListener("touchcancel", onTouchEnd, { passive: false });
  surface.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  return () => {
    surface.removeEventListener("touchstart", onTouchStart);
    surface.removeEventListener("touchmove", onTouchMove);
    surface.removeEventListener("touchend", onTouchEnd);
    surface.removeEventListener("touchcancel", onTouchEnd);
    surface.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}

// Legacy fixed-pad rotator. Currently unused now that the canvas itself
// is the rotate surface, but kept exported for any future fallback.
export function bindRotatePad(
  pad: HTMLElement,
  knob: HTMLElement,
  onRotate: RotateHandler,
): () => void {
  let active = false;
  const KNOB_HALF = 15; // half of the 30px knob
  const KNOB_INSET = 6; // distance from pad edge to knob centre when at the rim

  const resetKnob = () => {
    knob.style.top = `${KNOB_INSET}px`;
    knob.style.left = `calc(50% - ${KNOB_HALF}px)`;
  };

  const positionKnob = (angle: number) => {
    const rect = pad.getBoundingClientRect();
    const r = rect.width / 2 - KNOB_INSET - KNOB_HALF;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    knob.style.top = `${y - KNOB_HALF}px`;
    knob.style.left = `${x - KNOB_HALF}px`;
  };

  const computeAngle = (clientX: number, clientY: number): number => {
    const rect = pad.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    return Math.atan2(dy, dx);
  };

  const start = (clientX: number, clientY: number) => {
    active = true;
    pad.classList.add("active");
    const angle = computeAngle(clientX, clientY);
    positionKnob(angle);
    onRotate(angle);
  };

  const move = (clientX: number, clientY: number) => {
    if (!active) return;
    const angle = computeAngle(clientX, clientY);
    positionKnob(angle);
    onRotate(angle);
  };

  const end = () => {
    if (!active) return;
    active = false;
    pad.classList.remove("active");
    onRotate(null);
    resetKnob();
  };

  // Use targetTouches so multi-touch (e.g. one finger on this pad and a
  // second finger elsewhere) doesn't cross-contaminate. targetTouches only
  // contains touches that started on this element.
  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.targetTouches[0];
    if (t) start(t.clientX, t.clientY);
  };
  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.targetTouches[0];
    if (t) move(t.clientX, t.clientY);
  };
  const onTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    if (e.targetTouches.length === 0) end();
  };
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    start(e.clientX, e.clientY);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (active) move(e.clientX, e.clientY);
  };
  const onMouseUp = () => end();

  pad.addEventListener("touchstart", onTouchStart, { passive: false });
  pad.addEventListener("touchmove", onTouchMove, { passive: false });
  pad.addEventListener("touchend", onTouchEnd, { passive: false });
  pad.addEventListener("touchcancel", onTouchEnd, { passive: false });
  pad.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  resetKnob();

  return () => {
    pad.removeEventListener("touchstart", onTouchStart);
    pad.removeEventListener("touchmove", onTouchMove);
    pad.removeEventListener("touchend", onTouchEnd);
    pad.removeEventListener("touchcancel", onTouchEnd);
    pad.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}

// Bind a horizontal slider: while a finger (or mouse) is on the pad, the
// callback fires with a value in [-1, 1] mapped to the touch x position.
// On release, the callback fires with null.
export function bindSlider(
  pad: HTMLElement,
  knob: HTMLElement,
  onSlide: SlideHandler,
): () => void {
  let active = false;
  const KNOB_HALF = 24;
  const PAD_INSET = 8;

  const computeValue = (clientX: number): number => {
    const rect = pad.getBoundingClientRect();
    const usable = rect.width - 2 * (PAD_INSET + KNOB_HALF);
    if (usable <= 0) return 0;
    const offset = clientX - (rect.left + PAD_INSET + KNOB_HALF);
    const ratio = Math.max(0, Math.min(1, offset / usable));
    return ratio * 2 - 1;
  };

  const positionKnob = (value: number): void => {
    const rect = pad.getBoundingClientRect();
    const usable = rect.width - 2 * (PAD_INSET + KNOB_HALF);
    const ratio = (value + 1) / 2;
    const x = PAD_INSET + KNOB_HALF + ratio * usable - KNOB_HALF;
    knob.style.left = `${x}px`;
  };

  const resetKnob = () => {
    positionKnob(0);
  };

  const start = (clientX: number) => {
    active = true;
    pad.classList.add("active");
    const v = computeValue(clientX);
    positionKnob(v);
    onSlide(v);
  };
  const move = (clientX: number) => {
    if (!active) return;
    const v = computeValue(clientX);
    positionKnob(v);
    onSlide(v);
  };
  const end = () => {
    if (!active) return;
    active = false;
    pad.classList.remove("active");
    onSlide(null);
    resetKnob();
  };

  // Same multi-touch handling as the rotate pad — read targetTouches so a
  // second finger on a sibling control can't hijack this one.
  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.targetTouches[0];
    if (t) start(t.clientX);
  };
  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.targetTouches[0];
    if (t) move(t.clientX);
  };
  const onTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    if (e.targetTouches.length === 0) end();
  };
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    start(e.clientX);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (active) move(e.clientX);
  };
  const onMouseUp = () => end();

  pad.addEventListener("touchstart", onTouchStart, { passive: false });
  pad.addEventListener("touchmove", onTouchMove, { passive: false });
  pad.addEventListener("touchend", onTouchEnd, { passive: false });
  pad.addEventListener("touchcancel", onTouchEnd, { passive: false });
  pad.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  // Defer initial knob positioning until the pad has a measured width.
  requestAnimationFrame(resetKnob);

  return () => {
    pad.removeEventListener("touchstart", onTouchStart);
    pad.removeEventListener("touchmove", onTouchMove);
    pad.removeEventListener("touchend", onTouchEnd);
    pad.removeEventListener("touchcancel", onTouchEnd);
    pad.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}
