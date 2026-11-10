import { useEffect, useRef, useState } from "react";

import type { LedgerView } from "../../shared/ledger.ts";
import { layout } from "./layout.ts";
import { mapItems } from "./shown.ts";
import { snapOf, type Snap } from "./since.ts";
import type { Ledger } from "./useLedger.ts";

// coming back to the page after this long counts as a new look
const AWAY_MS = 5 * 60_000;

// What was filed since you last looked, and where stepping through it got
// to. `order` is every item on the map in order, folds open.
export function useSince(
  initial: LedgerView,
  view: LedgerView,
  order: string[],
  act: Ledger["act"],
) {
  const [snap, setSnap] = useState<Snap | null>(() =>
    snapOf(initial, layout(mapItems(initial.items)).order),
  );
  const [step, setStep] = useState(-1);

  // the latest view and order, for listeners set up once
  const latest = useRef({ view, order });
  useEffect(() => {
    latest.current = { view, order };
  }, [view, order]);

  // You look at the page when it gains focus after five minutes or more
  // away: the bar keeps what you had not seen, and the server counts from
  // now. Opened in view, the page is a look already.
  useEffect(() => {
    const inView = () =>
      document.visibilityState === "visible" && document.hasFocus();
    let away: number | null = inView() ? null : 0;
    if (away === null) void act({ type: "looked" });
    const back = () => {
      if (away === null) return;
      const long = Date.now() - away >= AWAY_MS;
      away = null;
      if (!long) return;
      setSnap(snapOf(latest.current.view, latest.current.order));
      setStep(-1);
      void act({ type: "looked" });
    };
    const gone = () => {
      away ??= Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") gone();
      else if (document.hasFocus()) back();
    };
    window.addEventListener("focus", back);
    window.addEventListener("blur", gone);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", back);
      window.removeEventListener("blur", gone);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [act]);

  const closeSince = () => {
    setSnap(null);
    setStep(-1);
  };
  return { snap, step, setStep, closeSince };
}
