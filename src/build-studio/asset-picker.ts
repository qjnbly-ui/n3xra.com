import { fileMime, FILE_ACCEPT, listAssetFiles, publishAssetFile, useAssetFile, type AssetFile, type AssetWebsite } from './asset-library.js';
export function setupAssetPicker(db: any, userId: string, getWebsite: () => AssetWebsite | null, prompt: HTMLTextAreaElement) {
  const dialog = document.querySelector<HTMLDialogElement>('#build-assets-dialog')!;
  const list = document.querySelector<HTMLElement>('#build-assets-list')!;
  const status = document.querySelector<HTMLElement>('#build-assets-status')!;
  const search = document.querySelector<HTMLInputElement>('#build-assets-search')!;
  const upload = document.querySelector<HTMLInputElement>('#build-assets-upload')!;
  const use = document.querySelector<HTMLButtonElement>('#build-assets-use')!;
  const attachments = document.querySelector<HTMLElement>('#build-attachments')!;
  let files: AssetFile[] = [], selected = new Set<string>(), attached: AssetFile[] = [], website: AssetWebsite | null = null, busy = false;
  upload.accept = FILE_ACCEPT;
  const current = () => website?.id === getWebsite()?.id;
  const showError = (error: unknown) => { status.textContent = error instanceof Error ? error.message : 'The files could not load. Try again.'; };
  function renderAttachments() {
    attachments.replaceChildren();
    for (const file of attached) {
      const chip = document.createElement('span'); chip.className = 'build-attachment';
      const link = document.createElement('a'); link.textContent = file.name; link.href = file.publicUrl!; link.target = '_blank'; link.rel = 'noopener';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove ' + file.name + ' from request');
      remove.onclick = () => { attached = attached.filter(f => f.id !== file.id); renderAttachments(); };
      chip.append(link, remove); attachments.append(chip);
    }
  }
  function attach(file: AssetFile) { if (current() && !attached.some(f => f.publicUrl === file.publicUrl)) { attached.push(file); renderAttachments(); } }
  function setBusy(value: boolean) { busy = value; upload.disabled = value; use.disabled = value || !selected.size; dialog.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(c => c.disabled = value || c.dataset.unsupported === 'true'); }
  function render() {
    list.replaceChildren();
    const visible = files.filter(f => f.name.toLowerCase().includes(search.value.toLowerCase()));
    for (const file of visible) {
      const label = document.createElement('label'); label.className = 'build-asset-option';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(file.id); let supported = true; try { fileMime(file.name, file.size); } catch { supported = false; }
      checkbox.disabled = busy || !supported; checkbox.dataset.unsupported = String(!supported);
      checkbox.onchange = () => { checkbox.checked ? selected.add(file.id) : selected.delete(file.id); use.disabled = busy || !selected.size; };
      const text = document.createElement('span'); const name = document.createElement('strong'); name.textContent = file.name;
      const detail = document.createElement('small'); detail.textContent = `${Math.ceil(file.size / 1024)} KB · ${!supported ? 'Not available for website use here' : file.publicUrl ? 'Website link ready' : 'Creates a public website copy'}`;
      text.append(name, detail); label.append(checkbox, text); list.append(label);
    }
    if (!visible.length) list.textContent = search.value ? 'No matching files.' : 'No files yet. Upload one below.';
  }
  document.querySelector<HTMLButtonElement>('#build-upload-files')!.onclick = async () => {
    if (busy) return;
    website = getWebsite(); if (!website) return;
    selected.clear(); files = []; search.value = ''; render(); status.textContent = 'Loading organization files…'; setBusy(true); dialog.showModal();
    try { const loaded = await listAssetFiles(db, website); if (current()) { files = loaded; render(); status.textContent = ''; } }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  document.querySelector<HTMLButtonElement>('#build-assets-close')!.onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  search.oninput = render;
  use.onclick = async () => {
    if (!website || busy || !current()) return;
    setBusy(true);
    try {
      for (const file of files.filter(f => selected.has(f.id))) {
        if (!current()) throw new Error('Website changed. Reopen the file picker.');
        status.textContent = 'Preparing ' + file.name + '…';
        attach(await useAssetFile(db, website, userId, file)); selected.delete(file.id);
      }
      dialog.close(); prompt.focus();
    } catch (error) { showError(error); render(); }
    finally { setBusy(false); }
  };
  upload.onchange = async () => {
    if (!website || busy || !current()) return;
    setBusy(true);
    try {
      for (const file of Array.from(upload.files || [])) {
        if (!current()) throw new Error('Website changed. Reopen the file picker.');
        status.textContent = 'Preparing and uploading ' + file.name + '…';
        const saved = await publishAssetFile(db, website, userId, file); attach(saved); files.unshift(saved);
      }
      dialog.close(); prompt.focus();
    } catch (error) { showError(error); render(); }
    finally { upload.value = ''; setBusy(false); }
  };
  return {
    context: () => attached.length ? '\n\nWebsite assets selected for this request (use these public URLs):\n' + JSON.stringify(attached.map(f => ({ name: f.name, url: f.publicUrl }))) : '',
    clear: () => { attached = []; renderAttachments(); },
    reset: () => { attached = []; selected.clear(); renderAttachments(); if (dialog.open) dialog.close(); },
  };
}
