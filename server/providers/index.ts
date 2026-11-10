// Which agent the map works with. Set LIVING_MAP_PROVIDER to pick another
// once one is added; Claude Code is the default.

import { claudeCode } from "./claude-code.ts";
import type { Agent } from "./types.ts";

const PROVIDERS: Record<string, (opts: { home: string }) => Agent> = {
  "claude-code": claudeCode,
};

export function pickProvider(
  name: string | undefined,
  opts: { home: string },
): Agent {
  const make = PROVIDERS[name || "claude-code"];
  if (!make)
    throw new Error(
      `Unknown LIVING_MAP_PROVIDER "${name}". Known: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  return make(opts);
}

export type { Agent } from "./types.ts";
