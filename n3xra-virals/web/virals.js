const form = document.getElementById("virals-analyze-form");
const statusEl = document.getElementById("analysis-status");

function setStatus(message) {
  statusEl.textContent = message;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const url = String(data.get("url") || "").trim();
  if (!url) {
    setStatus("Paste a video URL first.");
    return;
  }

  setStatus("Analyzer endpoint is ready to wire. Next step: connect the Virals API.");
});
