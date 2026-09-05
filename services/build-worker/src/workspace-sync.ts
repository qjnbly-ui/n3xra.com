export type GitRunner = (args: string[]) => Promise<string>;

// Fetching is done by the authenticated coordinator. Never reset or force-push.
export async function syncWorkingCopy(git: GitRunner, baseBranch: string, workingBranch: string) {
  const refs = [...new Set([workingBranch, baseBranch])];
  let updated = false;
  for (const branch of refs) {
    if (!(await git(['branch', '-r', '--list', `origin/${branch}`])).trim()) continue;
    const counts = (await git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`])).trim().split(/\s+/).map(Number);
    if (!counts[1]) continue;
    if ((await git(['status', '--porcelain'])).trim()) throw new Error('Sync needs attention: save a checkpoint of your unfinished changes, then sync again. Nothing was overwritten.');
    try { await git(['-c', 'core.hooksPath=/dev/null', 'merge', '--no-edit', `origin/${branch}`]); }
    catch (error) {
      await git(['merge', '--abort']).catch(() => undefined);
      throw new Error(`Sync needs attention: GitHub changes could not be combined safely. Your work is preserved. Resolve the branch differences before continuing. Details: ${String(error)}`);
    }
    updated = true;
  }
  return updated;
}

export async function verifyRemoteHead(git: GitRunner, branch: string) {
  const local = (await git(['rev-parse', 'HEAD'])).trim();
  const remote = (await git(['ls-remote', '--heads', 'origin', branch])).trim().split(/\s+/)[0];
  if (!remote || remote !== local) throw new Error('Push could not verify the latest changes on GitHub. The workspace remains open; try again.');
  if ((await git(['status', '--porcelain'])).trim()) throw new Error('Push found additional unfinished changes. The workspace remains open; try again.');
  return local;
}
