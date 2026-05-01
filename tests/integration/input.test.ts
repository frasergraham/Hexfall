// Input bindings test. Synthesizes keyboard events and asserts the
// handler routes them through KEY_MAP correctly. Also verifies the
// text-input guard (Q/E used both as game keys AND as letters in
// the editor name field).

import { describe, expect, it } from "vitest";
import { bindInput } from "../../src/input";
import type { InputAction } from "../../src/types";

function buildTouchbar(): HTMLElement {
  const el = document.createElement("div");
  el.id = "touchbar";
  el.innerHTML = `
    <button data-action="left">L</button>
    <button data-action="right">R</button>
    <button data-action="rotateCcw">CCW</button>
    <button data-action="rotateCw">CW</button>
  `;
  document.body.appendChild(el);
  return el;
}

describe("bindInput keyboard mapping", () => {
  it("maps each KEY_MAP entry to the right InputAction", () => {
    const touchbar = buildTouchbar();
    const events: Array<[InputAction, boolean]> = [];
    const cleanup = bindInput(touchbar, (a, p) => events.push([a, p]));

    const cases: Array<[string, InputAction]> = [
      ["ArrowLeft", "left"], ["KeyA", "left"],
      ["ArrowRight", "right"], ["KeyD", "right"],
      ["KeyQ", "rotateCcw"], ["KeyZ", "rotateCcw"],
      ["KeyE", "rotateCw"], ["KeyX", "rotateCw"],
      ["Space", "confirm"], ["Enter", "confirm"],
      ["KeyP", "pause"],
    ];
    for (const [code, expected] of cases) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
      const lastDown = events[events.length - 2];
      const lastUp = events[events.length - 1];
      expect(lastDown).toEqual([expected, true]);
      expect(lastUp).toEqual([expected, false]);
    }

    cleanup();
    document.body.removeChild(touchbar);
  });

  it("ignores keys without a mapping", () => {
    const touchbar = buildTouchbar();
    const events: Array<[InputAction, boolean]> = [];
    const cleanup = bindInput(touchbar, (a, p) => events.push([a, p]));

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "F12" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(events).toEqual([]);

    cleanup();
    document.body.removeChild(touchbar);
  });

  it("ignores key repeat events", () => {
    const touchbar = buildTouchbar();
    const events: Array<[InputAction, boolean]> = [];
    const cleanup = bindInput(touchbar, (a, p) => events.push([a, p]));

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", repeat: true }));
    expect(events.filter(([, p]) => p === true).length).toBe(1);

    cleanup();
    document.body.removeChild(touchbar);
  });

  it("ignores game keys when an INPUT field is focused (editor name field)", () => {
    const touchbar = buildTouchbar();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const events: Array<[InputAction, boolean]> = [];
    const cleanup = bindInput(touchbar, (a, p) => events.push([a, p]));

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ" }));
    expect(events).toEqual([]);

    cleanup();
    document.body.removeChild(input);
    document.body.removeChild(touchbar);
  });

  it("touchbar buttons fire press + release callbacks via mouse events", () => {
    const touchbar = buildTouchbar();
    const events: Array<[InputAction, boolean]> = [];
    const cleanup = bindInput(touchbar, (a, p) => events.push([a, p]));

    const leftBtn = touchbar.querySelector<HTMLElement>('[data-action="left"]')!;
    leftBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    leftBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(events).toEqual([["left", true], ["left", false]]);
    expect(leftBtn.classList.contains("pressed")).toBe(false);

    cleanup();
    document.body.removeChild(touchbar);
  });

  it("returned cleanup removes window listeners", () => {
    const touchbar = buildTouchbar();
    const events: Array<[InputAction, boolean]> = [];
    const cleanup = bindInput(touchbar, (a, p) => events.push([a, p]));
    cleanup();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(events).toEqual([]);
    document.body.removeChild(touchbar);
  });
});
