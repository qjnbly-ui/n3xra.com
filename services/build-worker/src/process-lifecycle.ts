import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

// npm can exit before its dev-server descendants. Wait for the process group,
// not the launcher, before allowing another preview to take the same port.
export async function stopProcessGroup(child: ChildProcess) {
  const alive = () => {
    if (!child.pid) return false;
    if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  if (!alive()) return;
  signalProcessGroup(child, "SIGTERM");
  for (let attempt = 0; attempt < 20 && alive(); attempt++) await delay(50);
  if (alive()) signalProcessGroup(child, "SIGKILL");
  for (let attempt = 0; attempt < 40 && alive(); attempt++) await delay(50);
  if (alive()) throw new Error("The previous preview process group has not stopped. Retry after the worker recovers.");
}

// A restored VM can reuse the previous preview PID for its new launcher.
// Remove dead preview metadata before launching, never a live process's lock.
export async function removeStaleAstroLock(root: string) {
  const { readFile, unlink } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const path = join(root, ".astro", "dev.json");
  let data: { pid?: number };
  try { data = JSON.parse(await readFile(path, "utf8")); }
  catch { return; }
  if (!Number.isInteger(data.pid) || data.pid! <= 0) return;
  let alive = true;
  try { process.kill(data.pid!, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw error; }
  if (alive && process.platform === "linux") {
    const stat = await readFile(`/proc/${data.pid}/stat`, "utf8").catch(() => "");
    if (/^\s*Z\s/.test(stat.slice(stat.lastIndexOf(")") + 1))) alive = false;
  }
  if (!alive) await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
}
