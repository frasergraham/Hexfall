// Editor → Settings dialog. Edits seed, effect durations, danger size,
// star thresholds, and difficulty for the in-progress custom challenge.
// Pure render — caller (Game) wires `editor-settings-bump`,
// `editor-randomize-seed`, `editor-settings-auto`, `editor-dialog-ok`,
// `editor-dialog-cancel`, etc. handlers in the central listener.

import { escapeHtml } from "../escape";
import { helpTipHtml } from "../components/helpTip";
import type { CustomChallenge } from "../../customChallenges";

export interface SettingsDialogProps {
  challenge: CustomChallenge;
}

export function renderSettingsDialog(props: SettingsDialogProps): string {
  const c = props.challenge;
  const diffBtns = [1, 2, 3, 4, 5]
    .map((d) => `<button type="button" class="editor-diff-btn${c.difficulty === d ? " selected" : ""}" data-dialog-difficulty="${d}">${d}</button>`)
    .join("");
  const fmtSec = (v: number) => v.toFixed(1);
  const fmtInt = (v: number) => String(Math.round(v));
  return `
    <div class="editor-dialog-backdrop" data-action="editor-dialog-cancel"></div>
    <div class="editor-dialog editor-dialog-settings" role="dialog" aria-label="Challenge settings">
      <h2>Options</h2>
      <div class="editor-dialog-body">
        <div class="editor-quick-row">
          <span class="editor-quick-label">Seed${helpTipHtml("seed")}</span>
          <div class="editor-quick-controls">
            <input class="editor-meta-input editor-meta-input-seed" data-editor-field="seed" type="text" inputmode="numeric" value="${c.seed}" />
            <button type="button" class="editor-mix-step editor-mix-plus" data-action="editor-randomize-seed" aria-label="Random seed">⟳</button>
          </div>
        </div>
        ${stepper("slowDuration", "Slow duration (s)", c.effects.slowDuration, { min: 0, max: 30, step: 0.5, format: fmtSec })}
        ${stepper("fastDuration", "Fast duration (s)", c.effects.fastDuration, { min: 0, max: 30, step: 0.5, format: fmtSec })}
        ${stepper("shieldDuration", "Shield duration (s)", c.effects.shieldDuration, { min: 0, max: 60, step: 0.5, format: fmtSec })}
        ${stepper("droneDuration", "Drone duration (s)", c.effects.droneDuration, { min: 0, max: 60, step: 0.5, format: fmtSec })}
        ${stepper("dangerSize", "Danger size", c.effects.dangerSize, { min: 2, max: 15, step: 1, format: fmtInt })}
        <fieldset class="editor-radio-group">
          <legend>Star thresholds${helpTipHtml("starsAuto")}</legend>
          <div class="editor-stars-row">
            ${stepper("starOne", "★", c.stars.one, { min: 0, max: 9999, step: 5, format: fmtInt })}
            ${stepper("starTwo", "★★", c.stars.two, { min: 0, max: 9999, step: 5, format: fmtInt })}
            ${stepper("starThree", "★★★", c.stars.three, { min: 0, max: 9999, step: 5, format: fmtInt })}
          </div>
          <button type="button" class="challenge-back editor-auto-btn" data-action="editor-settings-auto">Auto-suggest</button>
        </fieldset>
        <fieldset class="editor-radio-group">
          <legend>Difficulty${helpTipHtml("difficulty")}</legend>
          <div class="editor-diff-row">${diffBtns}</div>
          <button type="button" class="challenge-back editor-auto-btn" data-action="editor-settings-auto-diff">Auto-suggest</button>
        </fieldset>
      </div>
      <div class="editor-dialog-actions">
        <button type="button" class="challenge-back" data-action="editor-dialog-cancel">Cancel</button>
        <button type="button" class="play-btn" data-action="editor-dialog-ok">OK</button>
      </div>
    </div>
  `;
}

function stepper(
  field: string,
  label: string,
  value: number,
  opts: { min: number; max: number; step: number; format: (v: number) => string },
): string {
  const eps = opts.step * 0.001;
  const atMin = value <= opts.min + eps;
  const atMax = value >= opts.max - eps;
  return `
    <div class="editor-quick-row">
      <span class="editor-quick-label">${escapeHtml(label)}${helpTipHtml(field)}</span>
      <div class="editor-quick-controls">
        <button type="button" class="editor-mix-step editor-mix-minus"
          data-action="editor-settings-bump" data-field="${field}" data-delta="${-opts.step}"
          ${atMin ? "disabled" : ""}>−</button>
        <span class="editor-mix-value">${opts.format(value)}</span>
        <button type="button" class="editor-mix-step editor-mix-plus"
          data-action="editor-settings-bump" data-field="${field}" data-delta="${opts.step}"
          ${atMax ? "disabled" : ""}>+</button>
      </div>
    </div>
  `;
}
