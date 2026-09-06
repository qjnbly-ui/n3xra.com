"use strict";
// Public build identity only. Used to verify the production domain serves the tested commit.
function handler(_req, res) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
module.exports = handler;
