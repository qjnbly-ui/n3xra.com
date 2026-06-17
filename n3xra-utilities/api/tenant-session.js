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

  const tenant = String(body.tenant || "").trim();
  if (!tenant) {
    sendJson(res, 400, { error: "A utility tenant is required." });
    return;
  }

  sendJson(res, 501, {
    error: "N3XRA Utilities tenant sessions are not wired yet.",
    tenant,
    next: [
      "Resolve utility tenant",
      "Load tenant Supabase project metadata",
      "Verify operator session against utility-owned Supabase",
      "Check N3XRA Utilities operator linkage",
      "Return portal account context",
    ],
  });
};
