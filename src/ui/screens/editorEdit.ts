// Editor → Edit screen. The scaffold that hosts the wave list (with
// thumbnails, drag handles, EDIT/× buttons), the name input + Options
// button, the Add Regular Wave / Add Custom Wave buttons, and the
// modal-dialog overlay (wave / customWave / settings).
//
// Pure render — caller (Game) pre-renders the dialog into HTML using
// the screen modules in this directory, then passes the resulting
// string in via `dialogHtml`. After insertion, Game still owns the
// post-render binding (paint canvases, bind drag handles, restore
// scroll positions, position the cell picker).

import { escapeHtml } from "../escape";
import { checkWaveLine, isCustomShapedWave, parseWaveLine, type ParsedWave } from "../../waveDsl";
import { helpTipHtml } from "../components/helpTip";
import type { CustomChallenge } from "../../customChallenges";

export interface EditorEditProps {
  challenge: CustomChallenge;
  /** Cap from customChallenges.ts. */
  maxWaves: number;
  /** Cap from customChallenges.ts. */
  maxNameLen: number;
  /** Currently-selected wave row (used for play-from-here + highlight). */
  selectedWaveIdx: number;
  /** Pre-rendered dialog markup (or empty string when no dialog open). */
  dialogHtml: string;
}

export function renderEditorEdit(props: EditorEditProps): string {
  const c = props.challenge;
  const wavesAtMax = c.waves.length >= props.maxWaves;
  const rows = c.waves.map((line, idx) => renderWaveRow(line, idx, props.selectedWaveIdx)).join("");

  return `
    <div class="editor-edit">
      <div class="challenge-select-top">
        <button type="button" class="challenge-back" data-action="editor-edit-back">← Save</button>
        <span style="font-size:13px; letter-spacing:0.18em; text-transform:uppercase; color:#aab4dc;">Edit Challenge</span>
        <span style="width:60px"></span>
      </div>
      <button type="button" class="play-btn editor-edit-play-big" data-action="editor-edit-play">PLAY</button>
      <div class="editor-edit-meta">
        <div class="editor-quick-row">
          <span class="editor-quick-label">Name${helpTipHtml("name")}</span>
          <div class="editor-quick-controls">
            <input class="editor-meta-input" data-editor-field="name" type="text" maxlength="${props.maxNameLen}" value="${escapeHtml(c.name)}" />
          </div>
        </div>
        <button type="button" class="editor-options-btn" data-action="editor-open-settings">
          <span class="editor-options-icon" aria-hidden="true">⚙</span>
          <span>Options</span>
        </button>
      </div>
      <div class="editor-wave-list">
        ${rows}
        <div class="editor-add-wave-row">
          <button type="button" class="editor-add-wave" data-action="editor-add-wave" ${wavesAtMax ? "disabled" : ""}>${wavesAtMax ? "Maximum 100 waves" : "+ Add Regular Wave"}</button>
          <button type="button" class="editor-add-wave editor-add-wave-custom" data-action="editor-add-custom-wave" ${wavesAtMax ? "disabled" : ""}>${wavesAtMax ? "" : "+ Add Custom Wave"}</button>
        </div>
      </div>
      ${props.dialogHtml}
    </div>
  `;
}

function renderWaveRow(line: string, idx: number, selectedWaveIdx: number): string {
  const check = checkWaveLine(line);
  let parsed: ParsedWave | null = null;
  try { parsed = parseWaveLine(line); } catch { parsed = null; }
  const selectedCls = idx === selectedWaveIdx ? " selected" : "";
  const warnCls = check.ok ? "" : " invalid";
  const warnBadge = check.ok
    ? ""
    : `<span class="editor-wave-warn" title="${escapeHtml(check.reason)}" aria-label="Wave invalid">!</span>`;

  let infoHtml: string;
  if (parsed) {
    const isCustom = isCustomShapedWave(line);
    const blocksPer10s = Math.round(10 / parsed.spawnInterval);
    const countLabel = parsed.countCap !== null && parsed.countCap > 0
      ? `<span class="editor-wave-info-item"><span class="editor-wave-info-label">×</span>${parsed.countCap}</span>`
      : "";
    const customBadge = isCustom
      ? `<span class="editor-wave-info-item editor-wave-info-custom">CUSTOM</span>`
      : "";
    infoHtml = `
      <div class="editor-wave-info">
        ${customBadge}
        <span class="editor-wave-info-item"><span class="editor-wave-info-label">Speed</span>${parsed.baseSpeedMul.toFixed(2)}</span>
        <span class="editor-wave-info-item"><span class="editor-wave-info-label">Rate</span>${blocksPer10s}/10s</span>
        ${countLabel}
      </div>
    `;
  } else {
    infoHtml = `<div class="editor-wave-info editor-wave-info-error">${escapeHtml(check.ok ? "" : check.reason)}</div>`;
  }

  return `
    <div class="editor-wave-row${selectedCls}${warnCls}" data-wave-idx="${idx}">
      <button type="button" class="editor-drag-handle" data-action="editor-drag" data-wave-idx="${idx}" aria-label="Drag to reorder">⋮⋮</button>
      <div class="editor-wave-canvas-wrap">
        ${infoHtml}
        <canvas class="editor-wave-thumb" data-wave-thumb="${idx}"></canvas>
        ${warnBadge}
      </div>
      <button type="button" class="editor-row-btn editor-row-btn-edit" data-action="editor-open-wave" data-wave-idx="${idx}">EDIT</button>
      <button type="button" class="editor-row-btn editor-row-btn-delete" data-action="editor-delete-wave" data-wave-idx="${idx}" aria-label="Delete wave">×</button>
    </div>
  `;
}
