import { useEffect, useState } from "react";

import { api } from "../lib/session.ts";

// What the page says over the map for a moment: something that went wrong,
// or a word on what just happened (a link copied). Each goes by itself.
export function useNotes() {
  const [error, setError] = useState("");
  // a word on what just happened (a link copied), gone by itself
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 6000);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);
  return { error, setError, note, setNote };
}

// this map in another browser of yours: the server makes a fresh one-time
// link and opens it there, or the page copies it for you to paste
export async function openElsewhere(
  conv: string,
  launch: boolean,
  setNote: (text: string) => void,
  setError: (text: string) => void,
) {
  try {
    const r = await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conv, launch }),
    });
    const b = (await r.json()) as { url?: string; error?: string };
    if (!r.ok || !b.url) {
      setError(b.error ?? "Couldn't make a link for another browser.");
      return;
    }
    if (launch) {
      setNote("Opening this map in your browser…");
      return;
    }
    await navigator.clipboard.writeText(b.url);
    setNote("Link copied. It works once and expires in 5 minutes.");
  } catch {
    setError("Couldn't reach the Living Map server. Is it running?");
  }
}
