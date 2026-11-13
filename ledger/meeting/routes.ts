// The recorder's routes (the Living Map Recorder Mac app, or anything that
// holds the local token):
//
//   POST /api/meetings                      {title?, app?}  → {conv, title, url}
//   POST /api/meetings/import               {title?, text, me?} → {conv, title, url}
//   POST /api/meetings/:conv/segments       {segments: [{text, speaker, start, end}]}
//   POST /api/meetings/:conv/end            → {ok}
//   POST /api/meetings/:conv/open           → {url}, a fresh sign-in link
//
// `url` is a one-time sign-in path that lands on the meeting's map.

import express from "express";

import type { Meetings } from "./meetings.ts";

export function meetingRoutes(
  meetings: Meetings,
  signIn: (conv: string) => string,
): express.Router {
  const router = express.Router();
  const body = (req: express.Request) =>
    (req.body ?? {}) as Record<string, unknown>;
  const fail = (res: express.Response, e: unknown) => {
    console.error("[meetings] failed:", e);
    res
      .status(500)
      .json({ error: "Something went wrong on the server. Try again." });
  };

  router.post("/", (req, res) => {
    try {
      const r = meetings.start(body(req));
      res.json({ ...r, url: signIn(r.conv) });
    } catch (e) {
      fail(res, e);
    }
  });
  router.post("/import", (req, res) => {
    try {
      const r = meetings.importText(body(req));
      if (r.error) res.status(400).json({ error: r.error });
      else res.json({ conv: r.conv, title: r.title, url: signIn(r.conv) });
    } catch (e) {
      fail(res, e);
    }
  });
  router.post("/:conv/segments", (req, res) => {
    try {
      const r = meetings.append(req.params.conv, body(req).segments);
      if (r.error)
        res.status(meetings.has(req.params.conv) ? 400 : 404).json(r);
      else res.json({ ok: true, count: r.count });
    } catch (e) {
      fail(res, e);
    }
  });
  router.post("/:conv/end", (req, res) => {
    try {
      const r = meetings.end(req.params.conv);
      if (r.error) res.status(404).json(r);
      else res.json({ ok: true });
    } catch (e) {
      fail(res, e);
    }
  });
  router.post("/:conv/open", (req, res) => {
    if (!meetings.has(req.params.conv)) {
      res.status(404).json({ error: "No meeting with that id." });
      return;
    }
    res.json({ url: signIn(req.params.conv) });
  });
  return router;
}
