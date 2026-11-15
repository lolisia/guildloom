/**
 * Level-up celebration state.
 *
 * `xp:changed` events carry the level transition, and quest clear responses
 * list every participant whose level rose. Both feed {@link useLevelUpStore};
 * the single `LevelUpModal` mounted by `AppLayout` renders the current entry
 * and dismisses it after three seconds (or on click).
 */
import type { LevelUp } from "@guildloom/shared";
import { create } from "zustand";

interface LevelUpState {
  /** The level transition currently being celebrated, if any. */
  current: LevelUp | null;
  /** Show `levelUp` (replacing any celebration already on screen). */
  show: (levelUp: LevelUp) => void;
  /** Hide the modal immediately. */
  dismiss: () => void;
}

/** Level-up queue/state shared by realtime and the clear-quest screen. */
export const useLevelUpStore = create<LevelUpState>((set) => ({
  current: null,

  show(levelUp) {
    set({ current: levelUp });
  },

  dismiss() {
    set({ current: null });
  },
}));
