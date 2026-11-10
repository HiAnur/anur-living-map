import { useEffect } from "react";

// ⌘F searches the map; Esc closes the search, then the card, then the side
// chat, then the list.
export function useMapKeys(
  open: {
    searching: boolean;
    selected: string | null;
    sideId: string | null;
    drawer: boolean;
  },
  set: {
    setSearching: (on: boolean) => void;
    setQuery: (text: string) => void;
    setSelected: (id: null) => void;
    setSideId: (id: null) => void;
    setDrawer: (on: boolean) => void;
  },
) {
  const { searching, selected, sideId, drawer } = open;
  const { setSearching, setQuery, setSelected, setSideId, setDrawer } = set;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearching(true);
      } else if (e.key === "Escape") {
        if (searching) {
          setSearching(false);
          setQuery("");
        } else if (selected) setSelected(null);
        else if (sideId) setSideId(null);
        else if (drawer) setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    searching,
    selected,
    drawer,
    sideId,
    setSearching,
    setQuery,
    setSelected,
    setSideId,
    setDrawer,
  ]);
}
