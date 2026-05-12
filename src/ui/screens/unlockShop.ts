// "Unlock everything" IAP shop screen. Phase 2.2.

import { escapeHtml } from "../escape";
import type { Screen } from "../Screen";

export interface UnlockShopProps {
  /** Localized price string from StoreKit (e.g. "$2.99"). Falsy when
   *  the product hasn't been fetched yet — the BUY button still
   *  renders, just without the price chip. */
  priceLabel: string | null | undefined;
  /** HARDCORE_UNLOCK_SCORE constant — the score on Hard that
   *  organically unlocks PAINFUL mode. */
  hardcoreUnlockScore: number;
}

export const UnlockShop: Screen<UnlockShopProps> = {
  render({ priceLabel, hardcoreUnlockScore }) {
    const priceLine = priceLabel
      ? `<span class="unlock-shop-price">${escapeHtml(priceLabel)}</span>`
      : "";
    return `
      <div class="unlock-shop">
        <div class="challenge-select-top">
          <button type="button" class="challenge-back" data-action="unlock-shop-back">← Back</button>
          <span class="challenge-select-title">Unlock everything</span>
          <span class="challenge-select-spacer" aria-hidden="true"></span>
        </div>
        <h1 class="unlock-shop-title">UNLOCK EVERYTHING</h1>
        <ul class="unlock-shop-list">
          <li><span class="unlock-shop-bullet">★</span><span>Open every challenge in all 6 blocks immediately</span></li>
          <li><span class="unlock-shop-bullet">★</span><span>Unlock <strong>PAINFUL</strong> difficulty</span></li>
          <li><span class="unlock-shop-bullet">★</span><span>Build and play your own challenges in the <strong>Challenge Editor</strong></span></li>
          <li><span class="unlock-shop-bullet">★</span><span>One-time purchase, restores across devices</span></li>
        </ul>
        <div class="unlock-shop-actions">
          <button type="button" class="play-btn unlock-shop-buy" data-action="iap-unlock">
            <span>BUY</span>
            ${priceLine}
          </button>
          <button type="button" class="challenge-back" data-action="iap-restore">Restore previous purchase</button>
        </div>
        <p class="unlock-shop-organic">
          Or earn it the long way: complete 3 of 5 challenges in a block to unlock the next, and score ${hardcoreUnlockScore} on Hard to unlock Painful mode.
        </p>
      </div>
    `;
  },
};
