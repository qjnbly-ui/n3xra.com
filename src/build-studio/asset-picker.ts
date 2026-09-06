import type { AssetFile, AssetWebsite } from './asset-library.js';
export function setupAssetPicker(_db: any, _userId: string, getWebsite: () => AssetWebsite | null, prompt: HTMLTextAreaElement) {
  const attachments = document.querySelector<HTMLElement>('#build-attachments')!;
  let attached: AssetFile[] = [];
  let channel: BroadcastChannel | null = null;
  function render() {
    attachments.replaceChildren();
    for (const file of attached) {
      const chip = document.createElement('span'); chip.className = 'build-attachment';
      const link = document.createElement('a'); link.textContent = file.name; link.href = file.publicUrl!; link.target = '_blank'; link.rel = 'noopener';
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', 'Remove ' + file.name + ' from request');
      remove.onclick = () => { attached = attached.filter(f => f.id !== file.id); render(); };
      chip.append(link, remove); attachments.append(chip);
    }
  }
  document.querySelector<HTMLButtonElement>('#build-upload-files')!.onclick = () => {
    const website = getWebsite(); if (!website) return;
    channel?.close();
    const key = crypto.randomUUID();
    const connection = channel = new BroadcastChannel('n3xra-build-assets-' + key);
    connection.onmessage = event => {
      const data = event.data;
      if (data?.type !== 'selected' || data.websiteId !== website.id || getWebsite()?.id !== website.id || !Array.isArray(data.files)) return;
      for (const file of data.files) {
        if (typeof file.id !== 'string' || typeof file.name !== 'string' || typeof file.publicUrl !== 'string' || !/^https:\/\//.test(file.publicUrl)) continue;
        if (!attached.some(f => f.publicUrl === file.publicUrl)) attached.push(file);
      }
      render(); connection.postMessage({ type: 'received' }); prompt.focus();
    };
    window.open(`/n3xra-admin/assets/?website=${encodeURIComponent(website.id)}&buildStudio=${key}`, '_blank', 'noopener');
  };
  return {
    context: () => attached.length ? '\n\nWebsite assets selected for this request (use these public URLs):\n' + JSON.stringify(attached.map(f => ({ name: f.name, url: f.publicUrl }))) : '',
    clear: () => { attached = []; render(); },
    reset: () => { attached = []; channel?.close(); channel = null; render(); },
  };
}
