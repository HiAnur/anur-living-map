import { useCallback, useMemo } from "react";

import type { LedgerView } from "../../shared/ledger.ts";
import { layout, type Size } from "./layout.ts";
import { changedIds, matcher } from "./lens.ts";
import { pendingItem } from "./pending.ts";
import { mapItems } from "./shown.ts";

// What the map draws from a view: its items by id, which are folded (your
// folds over the server's), where each box sits, and what the lenses count.
export function useShown(
  view: LedgerView,
  folds: Record<string, boolean>,
  size: Size,
) {
  const items = view.items;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const folded = useCallback(
    (id: string) => folds[id] ?? !!byId.get(id)?.folded,
    [folds, byId],
  );
  // what the map draws: findings stay in the card and the list; turns on
  // their way get a placeholder box (pending.ts)
  const mapped = useMemo(() => {
    const m = mapItems(items);
    const p = pendingItem(view);
    return p ? [...m, p] : m;
  }, [items, view]);
  const laid = useMemo(
    () => layout(mapped, folded, size),
    [mapped, folded, size],
  );
  // every item on the map in order, folds open: the order the since chip and
  // a lens step in
  const order = useMemo(() => layout(mapped).order, [mapped]);
  const changed = useMemo(
    () => changedIds(items, view.changes),
    [items, view.changes],
  );
  const counts = useMemo(
    () => ({
      waiting: items.filter(matcher("waiting", changed)).length,
      open: items.filter(matcher("open", changed)).length,
      decided: items.filter(matcher("decided", changed)).length,
      changed: changed.size,
    }),
    [items, changed],
  );
  // waits the map closed with no quote behind it, for you to check
  const toCheck = useMemo(
    () => items.filter((i) => !i.waiting && i.unconfirmed).length,
    [items],
  );
  // every topic that holds boxes, for Fold all and Unfold all
  const foldable = useMemo(
    () =>
      mapped
        .filter(
          (i) => i.type === "topic" && mapped.some((c) => c.parent === i.id),
        )
        .map((i) => i.id),
    [mapped],
  );

  return {
    items,
    byId,
    folded,
    mapped,
    laid,
    order,
    changed,
    counts,
    toCheck,
    foldable,
  };
}
