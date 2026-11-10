// The smaller pieces the map's screen puts around the map: its ⋯ menu, the
// banners under the strip, what a lens says when it lights nothing, the
// passing notes, and what an empty or unlinked map shows.

import type { ReactNode } from "react";

import type { ChangeStatement, LedgerView } from "../../shared/ledger.ts";
import type { UpdateStep } from "../../shared/model.ts";
import { Mark } from "../components/Logo.tsx";
import { More } from "../components/More.tsx";
import { UpdateButton } from "../components/UpdateButton.tsx";
import type { useUpdate } from "../lib/api.ts";
import type { Lens } from "./lens.ts";
import { Chip } from "./SideSheet.tsx";

// what a lens with nothing in it says, so a map dimmed all over reads as
// "none", not as broken
const NONE: Record<Lens, string> = {
  waiting: "Nothing is waiting on you",
  open: "Nothing is open",
  decided: "Nothing is decided yet",
  changed: "Nothing here is tied to a change in your system yet",
};

export function ScreenMenu({
  updates,
  update,
  compact,
  onStrip,
  tipsHidden,
  onTips,
  fixture,
  onElsewhere,
}: {
  updates: UpdateStep[];
  update: ReturnType<typeof useUpdate>;
  compact: boolean;
  onStrip: () => void;
  tipsHidden: boolean; // some tips were seen or turned off: they can come back
  onTips: () => void;
  fixture: boolean;
  onElsewhere: (launch: boolean) => void;
}) {
  return (
    <>
      <UpdateButton steps={updates} update={update} />
      <More
        sections={[
          {
            items: [
              {
                label: compact ? "Show the map" : "Strip only",
                onClick: onStrip,
              },
              ...(tipsHidden
                ? [
                    {
                      label: "Show tips again",
                      onClick: onTips,
                    },
                  ]
                : []),
            ],
          },
          {
            head: "This map elsewhere",
            items: fixture
              ? []
              : [
                  {
                    label: "Open in your browser",
                    title: "Opens this map in your default browser, signed in",
                    onClick: () => onElsewhere(true),
                  },
                  {
                    label: "Copy a link for another browser",
                    title: "A one-time link, good for 5 minutes",
                    onClick: () => onElsewhere(false),
                  },
                ],
          },
        ]}
      />
    </>
  );
}

export function Banners({
  offline,
  error,
}: {
  offline: boolean;
  error?: string;
}) {
  return (
    <>
      {offline && (
        <div className="bg-warning-soft px-3 py-1 text-[12.5px] text-warning-strong">
          Lost the connection to the Living Map server; reconnecting…
        </div>
      )}
      {error && (
        <div
          className="bg-danger-soft px-3 py-1 text-[12.5px] text-danger-strong"
          title={error}
        >
          The map couldn't file the latest turns. It tries again after the next
          one.
        </div>
      )}
    </>
  );
}

// what a lens says at the foot of the map: that it lights nothing, or, for
// Changed, how much changed in your system
export function LensNote({
  lens,
  count,
  changes,
  searching,
  drawer,
  onShow,
}: {
  lens: Lens | null;
  count: number;
  changes: ChangeStatement[];
  searching: boolean;
  drawer: boolean;
  onShow: () => void;
}) {
  return (
    <>
      {/* floats over the map, so turning the lens on moves nothing */}
      {lens &&
        count === 0 &&
        !(lens === "changed" && changes.length > 0) &&
        !searching &&
        !drawer && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[calc(100%-24px)] -translate-x-1/2 truncate rounded-full bg-surface px-3 py-1 text-[12.5px] text-body shadow-md ring-1 ring-line">
            {NONE[lens]}
          </div>
        )}
      {lens === "changed" && changes.length > 0 && !drawer && (
        <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-full bg-surface px-3 py-1 text-[12.5px] whitespace-nowrap text-body shadow-md ring-1 ring-line">
          <span className="truncate">
            {changes.filter((c) => !c.low).length} changes in your system this
            session
          </span>
          <button
            onClick={onShow}
            className="shrink-0 text-[12px] text-ink underline underline-offset-2"
          >
            Show them
          </button>
        </div>
      )}
    </>
  );
}

// the side chats not shown now, each a chip that opens it again
export function SideChips({
  sides,
  onOpen,
  onClose,
}: {
  sides: LedgerView["sides"];
  onOpen: (item: string) => void;
  onClose: (id: string) => void;
}) {
  if (!sides.length) return null;
  return (
    <div className="absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-24px)] gap-1 overflow-x-auto [scrollbar-width:none]">
      {sides.map((o) => (
        <Chip
          key={o.id}
          side={o}
          onOpen={() => onOpen(o.item)}
          onClose={() => onClose(o.id)}
        />
      ))}
    </div>
  );
}

// the strip alone, the map put away
export function StripOnly({
  children,
  onShow,
}: {
  children: ReactNode;
  onShow: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      {children}
      <button
        onClick={onShow}
        className="mx-3 mt-2 self-start rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] text-body hover:bg-panel"
      >
        Show the map
      </button>
    </div>
  );
}

export function Notes({
  note,
  error,
  onClose,
}: {
  note: string;
  error: string;
  onClose: () => void;
}) {
  return (
    <>
      {note && !error && (
        <div className="absolute top-2 left-1/2 z-40 max-w-[min(480px,calc(100%-32px))] -translate-x-1/2 rounded-lg bg-surface px-3 py-1.5 text-sm text-body shadow-md ring-1 ring-line">
          {note}
        </div>
      )}
      {error && (
        <div className="absolute top-2 left-1/2 z-40 flex max-w-[min(480px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-lg bg-warning-soft px-3 py-1.5 text-sm text-warning-strong shadow-md ring-1 ring-warning-line">
          <span className="min-w-0 flex-1">{error}</span>
          <button onClick={onClose} className="shrink-0">
            ×
          </button>
        </div>
      )}
    </>
  );
}

// nothing on the map yet: reading a long chat, or nothing filed
export function Empty({ view }: { view: LedgerView }) {
  const r = view.health.reading;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
      <div className="pointer-events-auto max-w-xs rounded-xl bg-surface p-4 text-center shadow-md ring-1 ring-line">
        {r ? (
          <>
            <div className="text-[14px] font-medium text-ink">
              Reading your chat
            </div>
            <p className="mt-1 text-[12.5px] text-body">
              {r.done} of {r.total} turns so far. What's asked, decided and left
              to do shows up as it's found.
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${Math.round((100 * r.done) / Math.max(1, r.total))}%`,
                }}
              />
            </div>
          </>
        ) : view.health.error ? (
          <>
            <div className="text-[14px] font-medium text-ink">
              The map couldn't read your chat yet
            </div>
            <p className="mt-1 text-[12.5px] text-body">
              It tries again after the next turn.
            </p>
          </>
        ) : (
          <>
            <div className="text-[14px] font-medium text-ink">
              Nothing filed yet
            </div>
            <p className="mt-1 text-[12.5px] text-body">
              As you and Claude talk, what's asked, decided and left to do shows
              up here.
              {view.health.behind > 0
                ? ` ${view.health.behind} turns are still to read.`
                : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function Notice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas px-6">
      <div className="max-w-sm text-center">
        <Mark size={36} className="mx-auto" />
        <h1 className="mt-3 text-[15px] font-semibold text-ink">{title}</h1>
        <p className="mt-1.5 text-[13px] text-body">{children}</p>
      </div>
    </div>
  );
}
