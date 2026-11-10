import { ReactFlowProvider } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  LedgerAction,
  LedgerItem,
  LedgerView,
} from "../../shared/ledger.ts";
import { useUpdate } from "../lib/api.ts";
import { store, stored } from "../lib/storage.ts";
import { SIDE_BY_SIDE, startAt, useCamera } from "./camera.ts";
import { Canvas } from "./Canvas.tsx";
import { Card } from "./Card.tsx";
import { Drawer } from "./Drawer.tsx";
import { holdView, layout, NARROW_PANE, ROOT, type Layout } from "./layout.ts";
import {
  foldsAbove,
  litBy,
  matcher,
  nowTopic,
  search,
  type Lens,
} from "./lens.ts";
import { openElsewhere, useNotes } from "./notes.ts";
import {
  Banners,
  Empty,
  LensNote,
  Notes,
  Notice,
  ScreenMenu,
  SideChips,
  StripOnly,
} from "./ScreenParts.tsx";
import { SearchBox } from "./SearchBox.tsx";
import { startFolds } from "./shown.ts";
import { SideSheet } from "./SideSheet.tsx";
import { newIds } from "./since.ts";
import { SinceChip, Strip } from "./Strip.tsx";
import { MapTips, Tip } from "./Tips.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useLedger } from "./useLedger.ts";
import { useMapKeys } from "./useMapKeys.ts";
import { useShown } from "./useShown.ts";
import { useSince } from "./useSince.ts";
import { useTips } from "./useTips.ts";

// The map of your chat: the strip, the lenses, and the mind map itself,
// with a card for the item you click and the list as a drawer.
export default function MapScreen({
  initial,
  fixture,
}: {
  initial: LedgerView;
  fixture: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Screen initial={initial} fixture={fixture} />
    </ReactFlowProvider>
  );
}

function Screen({
  initial,
  fixture,
}: {
  initial: LedgerView;
  fixture: boolean;
}) {
  const { view, sides, online, linked, updates, act } = useLedger(
    initial,
    fixture,
  );
  const update = useUpdate();

  const [lens, setLens] = useState<Lens | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // folds you set here, over the server's, so a fold shows at once; the
  // page opens with every topic but Claude's folded (shown.ts)
  const [folds, setFolds] = useState<Record<string, boolean>>(() =>
    startFolds(initial.items, initial.now),
  );
  // the list group to show on top (the Decided lens opens the list there)
  const [listFirst, setListFirst] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [changesFirst, setChangesFirst] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(() => stored("map.compact", false));
  const { tipsSeen, tipsOff, seeTip, tipsAgain } = useTips();
  const [following, setFollowing] = useState(false);
  const { error, setError, note, setNote } = useNotes();
  // this map in another browser of yours: the server makes a fresh one-time
  // link and opens it there, or the page copies it for you to paste
  const handOff = (launch: boolean) =>
    openElsewhere(view.conv, launch, setNote, setError);
  // the side chat shown over the lower half; the others wait as chips
  const [sideId, setSideId] = useState<string | null>(null);
  // where stepping through a lens got to, for the lens it was on
  const [lensStep, setLensStep] = useState<{ lens: Lens | null; at: number }>({
    lens: null,
    at: -1,
  });
  const { rf, width, height, size, beside, centre, frameLeft } =
    useCamera(drawer);
  // where the camera was, so the map comes back there after strip-only
  const [camera, setCamera] = useState(() => startAt(initial));

  const {
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
  } = useShown(view, folds, size);
  const { snap, step, setStep, closeSince } = useSince(
    initial,
    view,
    order,
    act,
  );
  const lit = useMemo((): ((i: LedgerItem) => boolean) | null => {
    if (searching && query.trim()) {
      const ids = new Set(search(items, query).map((i) => i.id));
      return (i) => ids.has(i.id);
    }
    return lens ? litBy(lens, items, changed) : null;
  }, [searching, query, items, lens, changed]);
  const marked = useMemo(
    () => new Set([...(snap?.ids ?? []), ...newIds(view)]),
    [snap, view],
  );
  // an item that left the map (Not right, or merged) closes its card
  const card = selected ? (byId.get(selected) ?? null) : null;
  const now = nowTopic(items, view.now);
  // a side chat you ended (here or on another page) is no longer shown
  const side =
    sideId && view.sides.some((x) => x.id === sideId)
      ? (sides[sideId] ?? null)
      : null;
  const otherSides = view.sides.filter((x) => x.id !== side?.id);
  // what the lens lights up, in map order, for its stepper
  const lensIds = useMemo(() => {
    if (!lens) return [];
    const m = matcher(lens, changed);
    return order.filter((id) => {
      const i = byId.get(id);
      return !!i && i.type !== "topic" && m(i);
    });
  }, [lens, changed, order, byId]);
  const lensAt = lensStep.lens === lens ? lensStep.at : -1;
  const firstWaiting =
    view.strip.waiting.map((id) => byId.get(id)).find(Boolean) ??
    items.find((i) => i.waiting) ??
    null;

  const run = useCallback(
    async (a: LedgerAction) => {
      const r = await act(a);
      if (!r.ok) setError(r.error ?? "That didn't go through.");
      return r;
    },
    [act, setError],
  );

  // open the folds an item sits in (and, for Now, the topic itself); gives
  // the layout it will have, so the camera can go there at once
  const reveal = (id: string, self = false): Layout => {
    const open = foldsAbove(items, id, folded);
    if (self && folded(id)) open.push(id);
    if (!open.length) return laid;
    const next = { ...folds };
    for (const f of open) {
      next[f] = false;
      void run({ type: "fold", item: f, folded: false });
    }
    setFolds(next);
    return layout(mapped, (x) => next[x] ?? !!byId.get(x)?.folded, size);
  };

  const setStrip = (on: boolean) => {
    setCompact(on);
    store("map.compact", on);
  };

  const pick = (id: string) => {
    const item = byId.get(id);
    if (!item) return;
    // picked from the strip alone: the map comes back to show it
    if (compact) setStrip(false);
    setFollowing(false);
    const l = reveal(id);
    if (item.type === "topic") {
      // a topic goes to the left edge, so what it holds is in view
      setSelected(null);
      frameLeft(id, l);
    } else {
      setSelected(id);
      centre(id, l, true);
    }
  };

  const toggleFold = (id: string) => {
    const next = !folded(id);
    setFolds((f) => ({ ...f, [id]: next }));
    void run({ type: "fold", item: id, folded: next });
  };

  const allFolded = foldable.length > 0 && foldable.every(folded);
  const foldAll = () => {
    const to = !allFolded;
    const next = { ...folds };
    for (const id of foldable) {
      if (folded(id) === to) continue;
      next[id] = to;
      void run({ type: "fold", item: id, folded: to });
    }
    setFolds(next);
    setFollowing(false);
    if (!to) return;
    // a box folded away takes its card with it, and the camera goes back
    // to the start of the map, where every topic is now one line
    setSelected(null);
    frameLeft(
      ROOT,
      layout(mapped, (x) => next[x] ?? !!byId.get(x)?.folded, size),
    );
  };

  const goNow = () => {
    if (!now) return;
    const l = reveal(now.id, true);
    setSelected(null);
    setFollowing(true);
    frameLeft(now.id, l);
  };
  // New boxes land at the top of their group (newest first), pushing what is
  // under them down: further down the map, the camera moves with them, so
  // what you are looking at stays put while the rows above fill in. Only for
  // items arriving: a fold, a pick or Now moves the camera on purpose.
  const shown = useRef({ laid, mapped, folds });
  useLayoutEffect(() => {
    const prev = shown.current;
    shown.current = { laid, mapped, folds };
    if (prev.mapped === mapped || prev.folds !== folds || following) return;
    const vp = rf.getViewport();
    const dy = holdView(prev.laid, laid, -vp.y / vp.zoom, size);
    if (dy) void rf.setViewport({ ...vp, y: vp.y - dy * vp.zoom });
  }, [laid, mapped, folds, following, rf, size]);

  // following Now: the camera stays on that topic as the map grows, until
  // you move it yourself
  const nowId = now?.id ?? null;
  useEffect(() => {
    if (following && nowId) frameLeft(nowId, laid, 200);
  }, [following, nowId, laid, frameLeft]);

  const onNode = (id: string) => {
    const item = byId.get(id);
    if (!item) return;
    if (item.type === "topic") return toggleFold(id);
    if (selected === id) return setSelected(null);
    setSelected(id);
    // on a narrow pane the card covers the top: an item under it comes down
    const p = laid.nodes.get(id);
    const vp = rf.getViewport();
    if (p && width < NARROW_PANE && p.y * vp.zoom + vp.y < height * 0.55)
      centre(id, laid, true);
  };

  const stepTo = (to: number) => {
    if (!snap) return;
    const id = snap.ids[to];
    if (!id) return;
    setStep(to);
    pick(id);
  };

  const stepLens = (to: number) => {
    const id = lensIds[to];
    if (!id) return;
    setLensStep({ lens, at: to });
    pick(id);
  };

  // a side chat on an item: the one open on it, or a new one; the item
  // goes to the half above the sheet
  const openSide = async (id: string) => {
    const r = await run({ type: "side-open", item: id });
    if (!r.ok || !r.side) return;
    setSideId(r.side.id);
    setSelected(null);
    setFollowing(false);
    const l = reveal(id);
    centre(id, l, false, true);
  };

  useMapKeys(
    { searching, selected, sideId, drawer },
    { setSearching, setQuery, setSelected, setSideId, setDrawer },
  );

  const more = (
    <ScreenMenu
      updates={updates}
      update={update}
      compact={compact}
      onStrip={() => setStrip(!compact)}
      tipsHidden={tipsOff || tipsSeen.size > 0}
      onTips={() => tipsAgain(false)}
      fixture={fixture}
      onElsewhere={(launch) => void handOff(launch)}
    />
  );

  if (!linked)
    return (
      <Notice title="This page isn't linked to a chat">
        Say <code>/living-map</code> in your Claude Code chat to link it again.
      </Notice>
    );

  const top = (
    <>
      <Strip
        view={view}
        firstWaiting={firstWaiting}
        onWaiting={pick}
        onWaitingLens={() => {
          // from the strip alone: the map comes back to show them
          if (compact) {
            setStrip(false);
            setLens("waiting");
          } else setLens(lens === "waiting" ? null : "waiting");
        }}
        waitingLens={lens === "waiting"}
        more={more}
      />
      <Banners offline={!online && !fixture} error={view.health.error} />
    </>
  );

  if (compact)
    return <StripOnly onShow={() => setStrip(false)}>{top}</StripOnly>;

  return (
    <div className="flex h-full flex-col bg-canvas">
      {top}
      <Toolbar
        lens={lens}
        counts={counts}
        since={
          snap && (
            <SinceChip
              snap={snap}
              at={step}
              onStep={stepTo}
              onClose={closeSince}
            />
          )
        }
        toCheck={toCheck}
        onLens={(l) => {
          // nothing waits but some closes need checking: the list opens on them
          if (l === "waiting" && !counts.waiting && toCheck) {
            setChangesFirst(false);
            setListFirst("check");
            setDrawer(true);
            return;
          }
          setLens(l);
          if (l === "changed" && view.changes.length) {
            setChangesFirst(true);
          }
          // the lens lights decisions on the map like any other; the list,
          // if it is open, shows them on top too
          if (l === "decided") {
            setChangesFirst(false);
            setListFirst("decided");
          } else if (lens === "decided") setListFirst(null);
        }}
        onSearch={() => setSearching(true)}
        onFoldAll={foldAll}
        allFolded={allFolded}
        canFold={foldable.length > 0}
        onNow={goNow}
        onList={() => {
          setChangesFirst(false);
          setListFirst(null);
          setDrawer(!drawer);
        }}
        listOpen={drawer}
        canNow={!!now}
        following={following}
        step={
          lens && !searching
            ? { at: lensAt, n: lensIds.length, onStep: stepLens }
            : undefined
        }
      />
      {/* clipped, not hidden: focus or find-in-page can scroll a hidden box
          sideways, shifting the whole map with no way back */}
      <main className="relative min-h-0 flex-1 overflow-clip">
        <Canvas
          title={view.title}
          // only what it draws, so a topic's counts are the boxes it opens to
          items={mapped}
          laid={laid}
          size={size}
          folded={folded}
          lit={lit}
          lens={searching && query.trim() ? null : lens}
          newIds={marked}
          selected={selected}
          initial={camera}
          now={now?.id ?? null}
          onNode={onNode}
          onPane={() => setSelected(null)}
          onUserMove={() => setFollowing(false)}
          onMoveEnd={setCamera}
        />
        {items.length === 0 && <Empty view={view} />}
        {!tipsOff &&
          !compact &&
          !card &&
          !side &&
          !drawer &&
          !searching &&
          items.length > 0 && (
            <MapTips
              laid={laid}
              byId={byId}
              size={size}
              lenses
              seen={tipsSeen}
              onSeen={seeTip}
              onOff={() => tipsAgain(true)}
            />
          )}
        <LensNote
          lens={lens}
          count={lens ? counts[lens] : 0}
          changes={view.changes}
          searching={searching}
          drawer={drawer}
          onShow={() => {
            setChangesFirst(true);
            setDrawer(true);
          }}
        />
        {searching && (
          <SearchBox
            items={items}
            query={query}
            onQuery={setQuery}
            onPick={(id) => {
              setSearching(false);
              setQuery("");
              pick(id);
            }}
            onClose={() => {
              setSearching(false);
              setQuery("");
            }}
          />
        )}
        {card && !searching && (
          <Card
            key={card.id}
            item={card}
            byId={byId}
            changes={view.changes}
            primary={!side}
            beside={beside}
            half={!!side}
            act={act}
            onPick={pick}
            onAsk={() => void openSide(card.id)}
            onClose={() => setSelected(null)}
            tip={
              !tipsOff && !tipsSeen.has("card") ? (
                <Tip
                  tip="card"
                  floating={false}
                  onDone={() => seeTip("card")}
                  onOff={() => tipsAgain(true)}
                />
              ) : null
            }
          />
        )}
        {side ? (
          <SideSheet
            key={side.id}
            side={side}
            item={byId.get(side.item) ?? null}
            others={otherSides}
            primary
            act={run}
            onItem={(id) => pick(id)}
            onOpen={(id) => void openSide(id)}
            onHide={() => setSideId(null)}
          />
        ) : (
          <SideChips
            sides={otherSides}
            onOpen={(item) => void openSide(item)}
            onClose={(id) => void run({ type: "side-close", side: id })}
          />
        )}
        <Drawer
          open={drawer}
          items={items}
          changes={view.changes}
          changesFirst={changesFirst}
          first={listFirst}
          selected={selected}
          newIds={marked}
          onPick={(id) => {
            // without room for the card beside it, the list steps aside
            if (width < SIDE_BY_SIDE) setDrawer(false);
            pick(id);
          }}
          onReview={(a) => void run(a)}
          onClose={() => setDrawer(false)}
        />
        <Notes note={note} error={error} onClose={() => setError("")} />
      </main>
    </div>
  );
}
