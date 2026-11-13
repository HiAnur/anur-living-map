// Runs the server and starts it again when it exits with RESTART_CODE: an
// older copy's last one-click update exits that way to start this version,
// which never updates again. Any other exit ends the launcher with the same
// code. `npm start` uses this.

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { RESTART_CODE } from "./config.ts";

const SERVER = fileURLToPath(new URL("./index.ts", import.meta.url));
let child: ChildProcess | null = null;

function start() {
  child = spawn(process.execPath, [SERVER], {
    stdio: "inherit",
    env: { ...process.env, LIVING_MAP_LAUNCHER: "1" },
  });
  child.on("exit", (code, signal) => {
    if (code === RESTART_CODE) {
      console.log("Living Map was updated; starting the new version…");
      start();
    } else process.exit(code ?? (signal ? 1 : 0));
  });
}

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => child?.kill(sig));
start();
