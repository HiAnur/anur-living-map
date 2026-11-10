import { useState } from "react";

import { store, stored } from "../lib/storage.ts";
import type { TipId } from "./tips.ts";

// The one-time tips you have seen, and whether you turned them all off:
// kept in this browser.
export function useTips() {
  const [tipsSeen, setTipsSeen] = useState(
    () => new Set(stored<string[]>("map.tips.seen", [])),
  );
  const [tipsOff, setTipsOff] = useState(() => stored("map.tips.off", false));
  const seeTip = (tip: TipId) => {
    const next = new Set([...tipsSeen, tip]);
    setTipsSeen(next);
    store("map.tips.seen", [...next]);
  };
  const tipsAgain = (off: boolean) => {
    setTipsOff(off);
    store("map.tips.off", off);
    if (!off) {
      setTipsSeen(new Set());
      store("map.tips.seen", []);
    }
  };
  return { tipsSeen, tipsOff, seeTip, tipsAgain };
}
