let activeDialog = null;

function escapeDialog(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function ensureDialog() {
  let modal = document.getElementById("n3xra-admin-dialog");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "n3xra-admin-dialog";
  modal.hidden = true;
  modal.innerHTML = `<div class="n3xra-admin-dialog-scrim" data-dialog-cancel></div><section class="n3xra-admin-dialog-card" role="dialog" aria-modal="true" aria-labelledby="n3xra-admin-dialog-title"><p class="portal-kicker">N3XRA Administration</p><h2 id="n3xra-admin-dialog-title"></h2><p id="n3xra-admin-dialog-copy"></p><label class="n3xra-admin-dialog-input-wrap" id="n3xra-admin-dialog-input-wrap"><span id="n3xra-admin-dialog-input-label"></span><input id="n3xra-admin-dialog-input" type="text"></label><div class="n3xra-admin-dialog-actions"><button class="portal-button portal-button-secondary" type="button" data-dialog-cancel>Cancel</button><button class="portal-button" id="n3xra-admin-dialog-confirm" type="button">Continue</button></div></section>`;
  document.body.append(modal);
  const style = document.createElement("style");
  style.id = "n3xra-admin-dialog-style";
  style.textContent = `.n3xra-admin-dialog[hidden]{display:none}.n3xra-admin-dialog{position:fixed;inset:0;z-index:200;display:grid;place-items:center;padding:1.25rem}.n3xra-admin-dialog-scrim{position:absolute;inset:0;background:rgba(4,10,18,.66);backdrop-filter:blur(5px)}.n3xra-admin-dialog-card{position:relative;width:min(480px,100%);padding:1.7rem;background:#fff;border:1px solid rgba(8,17,29,.1);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.28)}.n3xra-admin-dialog-card h2{margin:.35rem 0 .6rem;font-family:Fraunces,Georgia,serif;font-size:1.8rem}.n3xra-admin-dialog-card p:not(.portal-kicker){margin:0;color:var(--portal-muted);line-height:1.55;overflow-wrap:anywhere}.n3xra-admin-dialog-input-wrap{display:grid;gap:.4rem;margin-top:1.1rem;color:var(--portal-ink);font-size:.82rem;font-weight:700}.n3xra-admin-dialog-input-wrap input{width:100%;box-sizing:border-box;padding:.75rem .85rem;border:1px solid var(--portal-line);border-radius:9px;font:inherit}.n3xra-admin-dialog-actions{display:flex;justify-content:flex-end;gap:.65rem;margin-top:1.5rem}.n3xra-admin-dialog-input-wrap[hidden]{display:none}body.n3xra-admin-dialog-open{overflow:hidden}`;
  document.head.append(style);
  return modal;
}

export function adminDialog(options = {}) {
  const modal = ensureDialog();
  const title = modal.querySelector("#n3xra-admin-dialog-title");
  const copy = modal.querySelector("#n3xra-admin-dialog-copy");
  const inputWrap = modal.querySelector("#n3xra-admin-dialog-input-wrap");
  const inputLabel = modal.querySelector("#n3xra-admin-dialog-input-label");
  const input = modal.querySelector("#n3xra-admin-dialog-input");
  const confirm = modal.querySelector("#n3xra-admin-dialog-confirm");
  title.textContent = options.title || "Please confirm";
  copy.textContent = options.message || "Continue with this action?";
  confirm.textContent = options.confirmLabel || "Continue";
  inputWrap.hidden = !options.input;
  inputLabel.textContent = options.inputLabel || "Value";
  input.value = options.defaultValue || "";
  modal.hidden = false;
  document.body.classList.add("n3xra-admin-dialog-open");
  return new Promise((resolve) => {
    const finish = (value) => {
      modal.hidden = true;
      document.body.classList.remove("n3xra-admin-dialog-open");
      confirm.onclick = null;
      modal.querySelectorAll("[data-dialog-cancel]").forEach((element) => { element.onclick = null; });
      document.removeEventListener("keydown", onKeyDown);
      activeDialog = null;
      resolve(value);
    };
    const onKeyDown = (event) => { if (event.key === "Escape") finish(options.input ? null : false); if (event.key === "Enter" && options.input) finish(input.value); };
    confirm.onclick = () => finish(options.input ? input.value : true);
    modal.querySelectorAll("[data-dialog-cancel]").forEach((element) => { element.onclick = () => finish(options.input ? null : false); });
    document.addEventListener("keydown", onKeyDown);
    (options.input ? input : confirm).focus();
  });
}

export function confirmAdminAction(message, options = {}) {
  return adminDialog({ ...options, message, confirmLabel: options.confirmLabel || "Confirm" });
}

export function promptAdminText(message, options = {}) {
  return adminDialog({ ...options, message, input: true, confirmLabel: options.confirmLabel || "Save" });
}
