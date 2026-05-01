// Editor → Wave dialog. Modal that opens over the editorEdit screen
// when the user adds or edits a "regular" (probabilistic) wave. Pure
// render fed by a snapshot of the dialog state; Game owns the state
// fields + every mutator (`bumpClusterMix`, `mutateDialogWave`, etc.)
// and re-renders by calling renderEditorEdit which threads new props
// back in.

import { escapeHtml } from "../escape";
import { parseWaveLine, type ParsedWave } from "../../waveDsl";
import { WAVE_PRESETS } from "../../wavePresets";
import type { ClusterKind, WallKind } from "../../types";

export type HelpTipFn = (key: string) => string;

const WALL_LABEL: Record<WallKind, string> = {
  none: "No walls",
  pinch: "Pinch",
  zigzag: "Zigzag",
  narrow: "Narrow",
};

const MIX_KIND_ORDER: ClusterKind[] = [
  "normal", "sticky", "slow", "fast", "coin", "shield", "drone", "tiny", "big",
];

export interface WaveDialogProps {
  /** The current working DSL line — single source of truth for every
   *  wave-shape control. Mutators update it via composeWaveLine and
   *  re-render. */
  workingLine: string;
  /** True when OK appends a new wave; false when OK replaces at waveIdx. */
  isNewWave: boolean;
  /** Wave index this dialog is editing (ignored when isNewWave). */
  waveIdx: number | null;
  /** Currently-active preset id (drives the chip's "selected" state). */
  presetId: string | null;
  /** Whether the Presets collapsible is open. */
  presetsOpen: boolean;
  /** Whether the Advanced collapsible is open. */
  advancedOpen: boolean;
  /** Cluster mix percentages — one row per kind, totals 100. */
  pctValues: Partial<Record<ClusterKind, number>>;
  helpTip: HelpTipFn;
}

export function renderWaveDialog(props: WaveDialogProps): string {
  const fallback = "size=2-3, rate=0.7, speed=1.2, count=10";
  const line = props.workingLine || fallback;
  let parsed: ParsedWave | null = null;
  let parseErr = "";
  try {
    parsed = parseWaveLine(line);
  } catch (e) {
    parseErr = (e as Error).message;
    try { parsed = parseWaveLine(fallback); } catch { /* impossible */ }
  }
  if (!parsed) return "";
  const w = parsed;
  const hasSlots = w.slots.length > 0;
  const helpTip = props.helpTip;

  const presetChips = WAVE_PRESETS.map((p) => `
    <button type="button" class="editor-preset-chip${props.presetId === p.id ? " selected" : ""}"
      data-action="editor-preset-pick" data-preset-id="${escapeHtml(p.id)}"
      title="${escapeHtml(p.blurb)}">
      ${escapeHtml(p.name)}
    </button>
  `).join("");

  const countLabel = w.countCap === null ? "—" : String(w.countCap);
  const durLabel = w.durOverride === null ? "—" : `${w.durOverride.toFixed(1)}s`;
  const rateBlocks = Math.round(10 / w.spawnInterval);
  const rateLabel = `${rateBlocks}/10s`;
  const wallsName = WALL_LABEL[w.walls] ?? "No walls";

  const quickHtml = `
    <section class="editor-quick">
      <div class="editor-quick-row">
        <span class="editor-quick-label">Count${helpTip("count")}</span>
        <div class="editor-quick-controls">
          <button type="button" class="editor-mix-step editor-mix-minus"
            data-action="editor-bump-count" data-delta="-1"
            ${w.countCap === null ? "disabled" : ""}>−</button>
          <span class="editor-mix-value">${countLabel}</span>
          <button type="button" class="editor-mix-step editor-mix-plus"
            data-action="editor-bump-count" data-delta="1"
            ${(w.countCap ?? 0) >= 200 ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="editor-quick-row">
        <span class="editor-quick-label">Duration${helpTip("dur")}</span>
        <div class="editor-quick-controls">
          <button type="button" class="editor-mix-step editor-mix-minus"
            data-action="editor-bump-dur" data-delta="-0.5"
            ${w.durOverride === null ? "disabled" : ""}>−</button>
          <span class="editor-mix-value">${durLabel}</span>
          <button type="button" class="editor-mix-step editor-mix-plus"
            data-action="editor-bump-dur" data-delta="0.5"
            ${(w.durOverride ?? 0) >= 120 ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="editor-quick-row">
        <span class="editor-quick-label">Rate${helpTip("rate")}</span>
        <div class="editor-quick-controls">
          <button type="button" class="editor-mix-step editor-mix-minus"
            data-action="editor-bump-rate" data-delta="-5"
            ${w.spawnInterval >= 1.95 ? "disabled" : ""}>−</button>
          <span class="editor-mix-value">${rateLabel}</span>
          <button type="button" class="editor-mix-step editor-mix-plus"
            data-action="editor-bump-rate" data-delta="5"
            ${w.spawnInterval <= 0.0501 ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="editor-quick-row">
        <span class="editor-quick-label">Walls${helpTip("walls")}</span>
        <div class="editor-quick-walls-controls">
          <button type="button" class="editor-walls-arrow"
            data-action="editor-cycle-walls" data-dir="-1" aria-label="Previous wall">‹</button>
          <span class="editor-walls-name">${escapeHtml(wallsName)}</span>
          <button type="button" class="editor-walls-arrow"
            data-action="editor-cycle-walls" data-dir="1" aria-label="Next wall">›</button>
        </div>
      </div>
    </section>
  `;

  const mixHtml = renderClusterMix(props.pctValues, helpTip);
  const advancedHtml = renderWaveAdvanced(w, helpTip);

  const titleText = props.isNewWave
    ? "New wave"
    : `Wave ${(props.waveIdx ?? 0) + 1}`;
  const errBanner = parseErr
    ? `<div class="editor-dialog-err">Parse error: ${escapeHtml(parseErr)}</div>`
    : "";
  const slotsBanner = hasSlots
    ? `<div class="editor-dialog-note">Custom slot pattern (${w.slots.length} slots) — locked, coming in phase 2.</div>`
    : "";
  const advCls = props.advancedOpen ? "editor-advanced open" : "editor-advanced";
  const advChevron = props.advancedOpen ? "−" : "+";

  return `
    <div class="editor-dialog-backdrop" data-action="editor-dialog-cancel"></div>
    <div class="editor-dialog editor-dialog-wave" role="dialog" aria-label="${titleText}">
      <div class="editor-dialog-top">
        <button type="button" class="challenge-back" data-action="editor-dialog-ok">← Save</button>
        <h2>${escapeHtml(titleText)}</h2>
        <span style="width:60px"></span>
      </div>
      ${errBanner}
      ${slotsBanner}
      <button type="button" class="editor-section-toggle" data-action="editor-toggle-presets">
        <span class="editor-advanced-chevron">${props.presetsOpen ? "−" : "+"}</span> Preset Waves
      </button>
      <section class="editor-presets${props.presetsOpen ? " open" : ""}">
        <div class="editor-preset-chips">${presetChips}</div>
      </section>
      ${quickHtml}
      ${mixHtml}
      <button type="button" class="editor-advanced-toggle" data-action="editor-toggle-advanced">
        <span class="editor-advanced-chevron">${advChevron}</span> Advanced
      </button>
      <div class="${advCls}">
        ${advancedHtml}
      </div>
      <div class="editor-dialog-actions">
        <button type="button" class="challenge-back" data-action="editor-dialog-cancel">Cancel</button>
        <button type="button" class="play-btn" data-action="editor-dialog-ok">${props.isNewWave ? "ADD" : "OK"}</button>
      </div>
    </div>
  `;
}

function renderClusterMix(
  pctValues: Partial<Record<ClusterKind, number>>,
  helpTip: HelpTipFn,
): string {
  const rows = MIX_KIND_ORDER.map((kind) => {
    const isNormal = kind === "normal";
    const value = pctValues[kind] ?? 0;
    const buttons = isNormal
      ? `<span class="editor-mix-residual">auto</span>`
      : `
        <button type="button" class="editor-mix-step editor-mix-minus"
          data-action="editor-mix-bump" data-kind="${kind}" data-delta="-5"
          ${value <= 0 ? "disabled" : ""}>−</button>
        <span class="editor-mix-value">${value}<span class="editor-mix-pct">%</span></span>
        <button type="button" class="editor-mix-step editor-mix-plus"
          data-action="editor-mix-bump" data-kind="${kind}" data-delta="5"
          ${(pctValues.normal ?? 0) <= 0 ? "disabled" : ""}>+</button>
      `;
    const label = kind === "normal" ? "Normal" : kind.charAt(0).toUpperCase() + kind.slice(1);
    return `
      <div class="editor-mix-row${isNormal ? " editor-mix-row-normal" : ""}" data-mix-kind="${kind}">
        <canvas class="editor-mix-icon" data-mix-icon="${kind}" width="36" height="36"></canvas>
        <span class="editor-mix-name">${label}</span>
        <div class="editor-mix-controls">
          ${isNormal ? `<span class="editor-mix-value">${value}<span class="editor-mix-pct">%</span></span>` : ""}
          ${buttons}
        </div>
      </div>
    `;
  }).join("");
  return `
    <section class="editor-mix">
      <div class="editor-mix-header">
        <span>Cluster mix${helpTip("pct")}</span>
        <span class="editor-mix-total">100%</span>
      </div>
      <div class="editor-mix-rows">${rows}</div>
    </section>
  `;
}

function renderWaveAdvanced(w: ParsedWave, helpTip: HelpTipFn): string {
  const isZigzag = w.walls === "zigzag";
  const fmtInt = (v: number) => String(Math.round(v));
  const fmt2 = (v: number) => v.toFixed(2);
  const fmt1 = (v: number) => v.toFixed(1);
  const safeColLabel =
    w.safeCol === null ? "Random" : w.safeCol === "none" ? "None" : String(w.safeCol);
  const originLabel =
    w.origin === "top" ? "Top" : w.origin === "topAngled" ? "Top angled" : "Side";
  return `
    <div class="editor-dialog-body">
      ${stepper("sizeMin", "Size min", w.sizeMin, { min: 1, max: 5, step: 1, format: fmtInt }, helpTip)}
      ${stepper("sizeMax", "Size max", w.sizeMax, { min: 1, max: 5, step: 1, format: fmtInt }, helpTip)}
      ${stepper("speed", "Speed", w.baseSpeedMul, { min: 0.5, max: 3.0, step: 0.05, format: fmt2 }, helpTip)}
      ${stepper("wallAmp", "Wall amp", w.wallAmp, { min: 0, max: 0.5, step: 0.02, format: fmt2, disabled: !isZigzag }, helpTip)}
      ${stepper("wallPeriod", "Wall period", w.wallPeriod, { min: 0.05, max: 5, step: 0.1, format: fmt1, disabled: !isZigzag }, helpTip)}
      ${cycler("safeCol", "Safe column", safeColLabel, helpTip)}
      ${cycler("origin", "Origin", originLabel, helpTip)}
      ${stepper("dir", "Tilt", w.defaultDir, { min: -0.35, max: 0.35, step: 0.05, format: fmt2 }, helpTip)}
      ${toggle("dirRandom", "Random tilt", w.defaultDirRandom, helpTip)}
    </div>
  `;
}

function stepper(
  field: string,
  label: string,
  value: number,
  opts: {
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
    disabled?: boolean;
    helpKey?: string;
  },
  helpTip: HelpTipFn,
): string {
  const disabled = !!opts.disabled;
  const eps = opts.step * 0.001;
  const atMin = value <= opts.min + eps;
  const atMax = value >= opts.max - eps;
  const helpKey = opts.helpKey ?? field;
  return `
    <div class="editor-quick-row${disabled ? " editor-quick-row-disabled" : ""}">
      <span class="editor-quick-label">${escapeHtml(label)}${helpTip(helpKey)}</span>
      <div class="editor-quick-controls">
        <button type="button" class="editor-mix-step editor-mix-minus"
          data-action="editor-adv-bump" data-field="${field}" data-delta="${-opts.step}"
          ${disabled || atMin ? "disabled" : ""}>−</button>
        <span class="editor-mix-value">${opts.format(value)}</span>
        <button type="button" class="editor-mix-step editor-mix-plus"
          data-action="editor-adv-bump" data-field="${field}" data-delta="${opts.step}"
          ${disabled || atMax ? "disabled" : ""}>+</button>
      </div>
    </div>
  `;
}

function cycler(field: string, label: string, displayValue: string, helpTip: HelpTipFn): string {
  return `
    <div class="editor-quick-row">
      <span class="editor-quick-label">${escapeHtml(label)}${helpTip(field)}</span>
      <div class="editor-quick-walls-controls">
        <button type="button" class="editor-walls-arrow"
          data-action="editor-adv-cycle" data-field="${field}" data-dir="-1" aria-label="Previous">‹</button>
        <span class="editor-walls-name">${escapeHtml(displayValue)}</span>
        <button type="button" class="editor-walls-arrow"
          data-action="editor-adv-cycle" data-field="${field}" data-dir="1" aria-label="Next">›</button>
      </div>
    </div>
  `;
}

function toggle(field: string, label: string, on: boolean, helpTip: HelpTipFn): string {
  return `
    <div class="editor-quick-row">
      <span class="editor-quick-label">${escapeHtml(label)}${helpTip(field)}</span>
      <div class="editor-quick-controls">
        <button type="button" class="editor-walls-arrow"
          data-action="editor-adv-toggle" data-field="${field}"
          aria-pressed="${on ? "true" : "false"}">${on ? "ON" : "OFF"}</button>
      </div>
    </div>
  `;
}
