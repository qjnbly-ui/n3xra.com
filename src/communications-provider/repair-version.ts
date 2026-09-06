// Public build identity only. Used to verify the production domain serves the tested commit.
function handler(_req: unknown, res: { setHeader(name: string, value: string): void; status(code: number): { json(value: unknown): void } }) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
export = handler;
