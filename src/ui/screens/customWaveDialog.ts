// Editor → Custom Wave dialog. Slot-grid editor for hand-authored
// "scripted" waves: each row is one slot with a kind, size, position,
// and angle. Pure render fed by a snapshot of the editor's custom-
// wave state. Game owns the slots[] buffer + every mutator and
// re-renders by calling renderEditorEdit which threads new props back.

import { escapeHtml } from "../escape";
import type { ClusterKind, WallKind } from "../../types";

export type HelpTipFn = (key: string) => string;

export interface CustomWaveSlot {
  kind: ClusterKind;
  size: number;            // 1-5
  side: "main" | "left" | "right";
  col: number;             // 0-9 when side === "main"
  angleIdx: number;        // 0-6 for main; 7 left; 8 right
}

export interface CustomCellPicker {
  rowIdx: number;
  cellRect: DOMRect | null;
}

export interface CustomWaveDialogProps {
  isNewWave: boolean;
  waveIdx: number | null;
  paletteKinds: readonly ClusterKind[];
  selectedKind: ClusterKind;
  rate: number;        // slotInterval in seconds
  speed: number;       // baseSpeedMul
  walls: WallKind;
  optionsOpen: boolean;
  /** Full-length slots buffer. Caller passes the canonical CUSTOM_WAVE_LEN array. */
  slots: ReadonlyArray<CustomWaveSlot | null>;
  visibleRows: number;
  /** Cap on `visibleRows`. Caller passes CUSTOM_WAVE_LEN. */
  maxRows: number;
  /** Currently-open per-cell picker, or null when no cell is selected. */
  picker: CustomCellPicker | null;
  helpTip: HelpTipFn;
  /** Mapping from angleIdx → CSS rotation degrees for the slot arrow. */
  angleToCssRotation: (angleIdx: number) => number;
}

const WALL_LABEL: Record<WallKind, string> = {
  none: "No walls",
  pinch: "Pinch",
  zigzag: "Zigzag",
  narrow: "Narrow",
};

export function renderCustomWaveDialog(props: CustomWaveDialogProps): string {
  const titleText = props.isNewWave
    ? "New custom wave"
    : `Custom wave ${(props.waveIdx ?? 0) + 1}`;
  const helpTip = props.helpTip;

  const paletteHtml = props.paletteKinds.map((k) => {
    const sel = k === props.selectedKind ? " selected" : "";
    return `
      <button type="button" class="editor-custom-kind${sel}"
        data-action="editor-custom-kind" data-kind="${k}"
        aria-label="${escapeHtml(k)}">
        <canvas class="editor-custom-kind-icon" data-block-icon="${k}" width="36" height="36"></canvas>
        <span class="editor-custom-kind-label">${escapeHtml(k.toUpperCase())}</span>
      </button>
    `;
  }).join("");

  const rateBlocks = Math.round(10 / props.rate);
  const wallsName = WALL_LABEL[props.walls] ?? "No walls";
  const optionsChevron = props.optionsOpen ? "−" : "+";
  const optionsHtml = `
    <button type="button" class="editor-section-toggle" data-action="editor-custom-options-toggle">
      <span class="editor-advanced-chevron">${optionsChevron}</span> Options
    </button>
    <section class="editor-quick editor-custom-options${props.optionsOpen ? " open" : ""}">
      <div class="editor-quick-row">
        <span class="editor-quick-label">Rate${helpTip("rate")}</span>
        <div class="editor-quick-controls">
          <button type="button" class="editor-mix-step editor-mix-minus"
            data-action="editor-custom-rate" data-delta="-5"
            ${props.rate >= 1.95 ? "disabled" : ""}>−</button>
          <span class="editor-mix-value">${rateBlocks}/10s</span>
          <button type="button" class="editor-mix-step editor-mix-plus"
            data-action="editor-custom-rate" data-delta="5"
            ${props.rate <= 0.0501 ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="editor-quick-row">
        <span class="editor-quick-label">Speed${helpTip("speed")}</span>
        <div class="editor-quick-controls">
          <button type="button" class="editor-mix-step editor-mix-minus"
            data-action="editor-custom-speed" data-delta="-0.05"
            ${props.speed <= 0.55 ? "disabled" : ""}>−</button>
          <span class="editor-mix-value">${props.speed.toFixed(2)}</span>
          <button type="button" class="editor-mix-step editor-mix-plus"
            data-action="editor-custom-speed" data-delta="0.05"
            ${props.speed >= 2.95 ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="editor-quick-row">
        <span class="editor-quick-label">Walls${helpTip("walls")}</span>
        <div class="editor-quick-walls-controls">
          <button type="button" class="editor-walls-arrow" data-action="editor-custom-walls" data-dir="-1" aria-label="Previous wall">‹</button>
          <span class="editor-walls-name">${escapeHtml(wallsName)}</span>
          <button type="button" class="editor-walls-arrow" data-action="editor-custom-walls" data-dir="1" aria-label="Next wall">›</button>
        </div>
      </div>
    </section>
  `;

  const visible = Math.min(props.visibleRows, props.maxRows);
  const atCap = visible >= props.maxRows;
  const rowsHtml: string[] = [];
  rowsHtml.push(`
    <button type="button" class="editor-custom-addrow" data-action="editor-custom-addrow" ${atCap ? "disabled" : ""}>
      ${atCap ? `Maximum ${props.maxRows} rows` : "+ Add row"}
    </button>
  `);
  for (let i = visible - 1; i >= 0; i--) {
    rowsHtml.push(renderCustomWaveRow(i, props.slots[i] ?? null, props.angleToCssRotation));
  }
  const gridHtml = `
    <section class="editor-custom-grid" aria-label="Wave timeline">
      ${rowsHtml.join("")}
    </section>
  `;

  return `
    <div class="editor-dialog-backdrop" data-action="editor-dialog-cancel"></div>
    <div class="editor-dialog editor-dialog-custom-wave" role="dialog" aria-label="${titleText}">
      <div class="editor-dialog-top">
        <button type="button" class="challenge-back" data-action="editor-dialog-ok">← Save</button>
        <h2>${escapeHtml(titleText)}</h2>
        <span style="width:60px"></span>
      </div>
      ${optionsHtml}
      <section class="editor-custom-palette">
        <div class="editor-custom-palette-row">${paletteHtml}</div>
      </section>
      ${gridHtml}
      <div class="editor-dialog-actions">
        <button type="button" class="challenge-back" data-action="editor-dialog-cancel">Cancel</button>
        <button type="button" class="play-btn" data-action="editor-dialog-ok">${props.isNewWave ? "ADD" : "OK"}</button>
      </div>
    </div>
    ${renderCellPicker(props)}
  `;
}

function renderCellPicker(props: CustomWaveDialogProps): string {
  const picker = props.picker;
  if (!picker) return "";
  const slot = props.slots[picker.rowIdx];
  if (!slot) return "";
  const isSide = slot.side !== "main";
  const isPickup = slot.kind === "coin" || slot.kind === "shield" || slot.kind === "drone";
  const sizeButtons = [1, 2, 3, 4, 5].map((s) => {
    const disabled = isPickup && s > 1;
    return `
      <button type="button" class="editor-custom-pick-size${slot.size === s ? " selected" : ""}"
        data-action="editor-custom-pick-size" data-size="${s}"
        ${disabled ? "disabled" : ""}>
        <canvas class="editor-custom-pick-canvas" data-shape-icon="${slot.kind}:${s}" width="44" height="44"></canvas>
        <span class="editor-custom-pick-label">${s}</span>
      </button>
    `;
  }).join("");
  const angleOrder = [5, 3, 1, 0, 2, 4, 6];
  const angleButtons = angleOrder.map((a) => `
    <button type="button" class="editor-custom-pick-angle${slot.angleIdx === a ? " selected" : ""}"
      data-action="editor-custom-pick-angle" data-angle="${a}"
      aria-label="Angle ${a}">
      <span class="editor-custom-pick-arrow" style="transform: rotate(${props.angleToCssRotation(a)}deg)">↓</span>
    </button>
  `).join("");
  return `
    <div class="editor-custom-picker-backdrop" data-action="editor-custom-picker-close"></div>
    <div class="editor-custom-picker" role="dialog" aria-label="Edit block">
      <div class="editor-custom-picker-section">
        <span class="editor-custom-picker-label">Size</span>
        <div class="editor-custom-picker-sizes">${sizeButtons}</div>
      </div>
      ${isSide ? "" : `
        <div class="editor-custom-picker-section">
          <span class="editor-custom-picker-label">Direction</span>
          <div class="editor-custom-picker-angles">${angleButtons}</div>
        </div>
      `}
    </div>
  `;
}

function renderCustomWaveRow(
  rowIdx: number,
  slot: CustomWaveSlot | null,
  angleToCssRotation: (angleIdx: number) => number,
): string {
  const cellHtml = (
    side: "main" | "left" | "right",
    col: number,
  ): string => {
    const filled =
      !!slot &&
      slot.side === side &&
      (side !== "main" || slot.col === col);
    const sideAttr = side === "main" ? "" : ` data-side="${side}"`;
    const colAttr = side === "main" ? ` data-col="${col}"` : "";
    const sideCls = side === "main" ? "" : ` editor-custom-cell-side editor-custom-cell-${side}`;
    const filledCls = filled ? " has-hex" : "";
    const angle = filled && slot ? slot.angleIdx : 0;
    const rot = filled ? angleToCssRotation(angle) : 0;
    const kindAttr = filled && slot ? ` data-kind="${slot.kind}"` : "";
    const sizeText = filled && slot ? `<span class="editor-custom-size">${slot.size}</span>` : "";
    const arrow = filled && slot && slot.side === "main" && slot.angleIdx !== 0
      ? `<span class="editor-custom-arrow" style="transform: rotate(${rot}deg)">↓</span>`
      : "";
    const iconCanvas = filled
      ? `<canvas class="editor-custom-cell-icon" data-cell-icon="${rowIdx}-${side}-${col}" data-block-icon="${slot!.kind}" width="22" height="22"></canvas>`
      : "";
    return `
      <button type="button" class="editor-custom-cell${sideCls}${filledCls}"
        data-action="editor-custom-cell" data-row="${rowIdx}"${sideAttr}${colAttr}
        data-has-hex="${filled ? 1 : 0}"${kindAttr}>
        ${iconCanvas}${sizeText}${arrow}
      </button>
    `;
  };

  const mainCells: string[] = [];
  for (let col = 0; col < 10; col++) mainCells.push(cellHtml("main", col));

  return `
    <div class="editor-custom-row" data-row="${rowIdx}">
      ${cellHtml("left", 0)}
      <div class="editor-custom-row-main">${mainCells.join("")}</div>
      ${cellHtml("right", 0)}
      <button type="button" class="editor-custom-clear"
        data-action="editor-custom-clear" data-row="${rowIdx}"
        aria-label="Clear row">×</button>
    </div>
  `;
}
