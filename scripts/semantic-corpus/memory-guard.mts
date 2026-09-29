/** Memory watchdog for offline corpus/baseline runs (#506). macOS `memory_pressure -Q` reports a
 *  system-wide free percentage; below the floor the current stage is aborted instead of letting the
 *  machine swap to exhaustion. Other platforms fall back to os.freemem()/os.totalmem(). */
import { execFileSync } from "node:child_process";
import os from "node:os";

const POLL_MS = 2_000;
const FREE_PERCENT = /System-wide memory free percentage:\s*(\d+)%/;

export class MemoryFloorError extends Error {
  constructor(
    readonly freePercent: number,
    readonly floorPercent: number,
  ) {
    super(
      `System free memory ${freePercent}% fell below the ${floorPercent}% floor`,
    );
    this.name = "MemoryFloorError";
  }
}

export function freeMemoryPercent(): number {
  if (process.platform === "darwin") {
    const output = execFileSync("memory_pressure", ["-Q"], {
      encoding: "utf8",
    });
    const match = FREE_PERCENT.exec(output);
    if (match) return Number(match[1]);
  }
  return Math.floor((os.freemem() / os.totalmem()) * 100);
}

export function assertMemoryHeadroom(floorPercent: number): void {
  const free = freeMemoryPercent();
  if (free < floorPercent) throw new MemoryFloorError(free, floorPercent);
}

/** Polls in the background; `onBreach` runs once (it should kill child processes). */
export function startMemoryGuard(
  floorPercent: number,
  onBreach: (error: MemoryFloorError) => void,
): { stop: () => void; breach: () => MemoryFloorError | undefined } {
  let breached: MemoryFloorError | undefined;
  const timer = setInterval(() => {
    const free = freeMemoryPercent();
    if (free >= floorPercent || breached) return;
    breached = new MemoryFloorError(free, floorPercent);
    onBreach(breached);
  }, POLL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer), breach: () => breached };
}
