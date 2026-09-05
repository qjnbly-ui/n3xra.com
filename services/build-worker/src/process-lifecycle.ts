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
