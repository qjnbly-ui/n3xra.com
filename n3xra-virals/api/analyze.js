function parseJson(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") {
      resolve(req.body);
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        if (!chunks.length) {
          resolve({});
          return;
        }
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let body;
  try {
    body = await parseJson(req);
  } catch (error) {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const url = String(body.url || "").trim();
  if (!url) {
    sendJson(res, 400, { error: "A video URL is required." });
    return;
  }

  sendJson(res, 501, {
    error: "N3XRA Virals analyzer is not wired yet.",
    next: [
      "Verify Master session",
      "Check Virals product access",
      "Create Virals analysis row",
      "Fetch metadata/transcript",
      "Run AI analysis",
      "Save structured results",
    ],
  });
};

