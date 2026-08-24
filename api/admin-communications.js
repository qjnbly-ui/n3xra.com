const { listContacts, listMessages, listThreads, markRead, requirePlatformAdmin, sendMessage } = require("./_admin-communications");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST", "PATCH"].includes(req.method)) return res.status(405).json({ success: false, error: "Method not allowed." });
  try {
    const { user } = await requirePlatformAdmin(req);
    if (req.method === "GET") {
      if (req.query?.threadId) return res.status(200).json({ success: true, messages: await listMessages(req.query.threadId) });
      const [threads, contacts] = await Promise.all([listThreads(), listContacts()]);
      return res.status(200).json({ success: true, threads, contacts });
    }
    if (req.method === "PATCH") {
      if (req.body?.action !== "mark_read") return res.status(400).json({ success: false, error: "Unsupported action." });
      await markRead(req.body.threadId);
      return res.status(200).json({ success: true });
    }
    if ((req.body?.action || "send_sms") !== "send_sms") return res.status(400).json({ success: false, error: "Unsupported action." });
    const message = await sendMessage({ to: req.body?.to, body: req.body?.body, userId: user.id, req });
    return res.status(201).json({ success: true, message });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message || "Calls and messages are unavailable." });
  }
};
