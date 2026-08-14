const QRCode = require("qrcode");
const { clean, loadPublicWorkspace, loadSourceByType } = require("./_communications");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed.");
  }
  try {
    const data = await loadPublicWorkspace(req.query?.workspace);
    if (!data) return res.status(404).send("This subscription page is not active.");
    const source = await loadSourceByType(data.form.id, "qr_campaign");
    if (!source) return res.status(404).send("This QR campaign is not active.");
    const origin = clean(process.env.PUBLIC_SITE_URL || "https://n3xra.com", 300).replace(/\/+$/, "");
    const signupUrl = `${origin}/nexra-communications/subscribe/?workspace=${encodeURIComponent(data.workspace.slug)}&source=${encodeURIComponent(source.public_token)}`;
    const svg = await QRCode.toString(signupUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 720,
      color: { dark: "#0d2924", light: "#ffffff" },
    });
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (String(req.query?.download || "") === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="${data.workspace.slug}-signup-qr.svg"`);
    }
    return res.status(200).send(svg);
  } catch (error) {
    console.error("Communications QR generation failed:", error);
    return res.status(500).send("QR code is temporarily unavailable.");
  }
};
