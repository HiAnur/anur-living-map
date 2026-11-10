// The map's camera: where it starts, and the two moves it makes when you
// ask (a box brought to the middle, a topic framed at the left edge).

import { useReactFlow, useStore, type Viewport } from "@xyflow/react";
import { useCallback, useSyncExternalStore } from "react";

import type { LedgerView } from "../../shared/ledger.ts";
import {
  layout,
  NARROW,
  NARROW_PANE,
  ROOT,
  sizeFor,
  WIDE,
  type Layout,
} from "./layout.ts";
import { nowTopic } from "./lens.ts";
import { mapItems, startFolds } from "./shown.ts";

export const CARD_W = 400;
export const DRAWER_W = 360;
// from this width the card opens beside the open list instead of over it
export const SIDE_BY_SIDE = CARD_W + DRAWER_W + 320;

// the camera never starts or moves below this zoom: a box stays readable,
// and a column that runs off the right is a drag away
const MIN_ZOOM = 0.85;
const clampZoom = (z: number) => Math.min(1, Math.max(MIN_ZOOM, z));

// the window is the pane the map sits in; only crossing NARROW_PANE re-renders
const onResize = (f: () => void) => {
  window.addEventListener("resize", f);
  return () => window.removeEventListener("resize", f);
};
const isNarrow = () => window.innerWidth < NARROW_PANE;

// how far in from the pane's left edge a framed topic sits: on a narrow pane
// little enough that the topic, its items and theirs all fit
const marginX = (narrow: boolean) => (narrow ? 8 : 16);
// how far down a framed topic sits: on a narrow pane at the top, so what it
// holds fills the pane below it
const marginY = (narrow: boolean, h: number) =>
  narrow ? 16 : Math.min(h * 0.2, 120);

// Where the camera starts. On a narrow pane, the topic Claude is on at the
// top left, at full size, so its items read beside it. Wider, the whole tree
// from the chat's root, zoomed so its columns fill the width (never below
// MIN_ZOOM) instead of leaving the right of the pane empty; scrolled down to
// that topic only when it would start below the fold.
export function startAt(
  v: LedgerView,
  w = typeof window === "undefined" ? 1024 : window.innerWidth,
  h = typeof window === "undefined" ? 768 : window.innerHeight,
): Viewport {
  const size = sizeFor(w);
  const opening = startFolds(v.items, v.now);
  const l = layout(
    mapItems(v.items),
    (id) => opening[id] ?? !!v.items.find((i) => i.id === id)?.folded,
    size,
  );
  const t = nowTopic(v.items, v.now);
  const root = l.nodes.get(ROOT)!;
  const p = (t && l.nodes.get(t.id)) || root;
  let wide = 0;
  for (const n of l.nodes.values()) wide = Math.max(wide, n.x + size.w);
  const narrow = w < NARROW_PANE;
  const zoom = narrow
    ? 1
    : Math.min(1, Math.max(MIN_ZOOM, (w - 32) / Math.max(1, wide)));
  const left = narrow ? p : root;
  // the top of the map when that keeps the topic well in view
  const top = 16 + p.y * zoom < h * (narrow ? 0.4 : 0.6);
  return {
    x: Math.round(marginX(narrow) - left.x * zoom),
    y: Math.round(top ? 16 : marginY(narrow, h) - p.y * zoom),
    zoom: Math.round(zoom * 100) / 100,
  };
}

// The pane's size, the node size that goes with it, and the camera's moves.
// `drawer` says the list is open: wide enough, the card opens beside it.
export function useCamera(drawer: boolean) {
  const rf = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const narrowPane = useSyncExternalStore(onResize, isNarrow, () => false);
  // below NARROW_PANE the map draws its narrow nodes; it is also where the
  // card covers the top of the map instead of its side
  const size = narrowPane ? NARROW : WIDE;
  const beside = drawer && width >= SIDE_BY_SIDE;

  // the camera, moved only when you ask: a step, a pick, Now
  const centre = useCallback(
    (id: string, l: Layout, withCard: boolean, sheet = false) => {
      const p = l.nodes.get(id);
      if (!p) return;
      const zoom = clampZoom(rf.getZoom());
      const narrow = width < NARROW_PANE;
      // with the card open, the item lands beside it (and the list), not
      // under it; with a side chat open, in the half above it
      const dx =
        withCard && !narrow ? (CARD_W + (beside ? DRAWER_W : 0)) / 2 / zoom : 0;
      const dy = sheet
        ? -(height * 0.25) / zoom
        : withCard && narrow
          ? (height * 0.25) / zoom
          : 0;
      void rf.setCenter(p.x + size.w / 2 + dx, p.y + size.h / 2 - dy, {
        zoom,
        duration: 300,
      });
    },
    [rf, width, height, beside, size],
  );
  const frameLeft = useCallback(
    (id: string, l: Layout, duration = 300) => {
      const p = l.nodes.get(id);
      if (!p) return;
      const zoom = clampZoom(rf.getZoom());
      void rf.setViewport(
        {
          x: marginX(narrowPane) - p.x * zoom,
          y: marginY(narrowPane, height) - p.y * zoom,
          zoom,
        },
        { duration },
      );
    },
    [rf, height, narrowPane],
  );

  return { rf, width, height, size, beside, centre, frameLeft };
}
