import { publishAssetFile, type AssetFile, type AssetWebsite } from './asset-library.js';
import { getAdminSession } from '/account/admin/admin-session.js';
export function setupAssetPicker(db: any, userId: string, getWebsite: () => AssetWebsite | null, prompt: HTMLTextAreaElement) {
  const attachments = document.querySelector<HTMLElement>('#build-attachments')!;
  let attached: AssetFile[] = [], loaded = false, loading = false;
  let browser: typeof import('/account/admin/files/files.js?v=28');
  let website: AssetWebsite | null = null;
  const prepared = new Map<string, AssetFile>();
  const dialog = document.createElement('dialog'); dialog.id = 'build-internal-files'; dialog.setAttribute('aria-label','Internal Files');
  dialog.innerHTML = '<header class="build-files-heading"><h2>Internal Files</h2><button type="button" class="build-button build-button-secondary" data-close-files>Close</button></header><div class="build-files-body"></div><footer class="build-files-footer"><p role="status" data-files-status></p><button type="button" class="build-button" data-use-files>Use selected files</button></footer>';
  document.body.append(dialog);
  const status = dialog.querySelector<HTMLElement>('[data-files-status]')!;
  const use = dialog.querySelector<HTMLButtonElement>('[data-use-files]')!;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close-files]')!;
  close.onclick = () => { if (!loading) dialog.close(); };
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape' && dialog.querySelector('.n3xra-modal:not([hidden])')) event.preventDefault(); });
  dialog.addEventListener('cancel', event => { if (loading || dialog.querySelector('.n3xra-modal:not([hidden])')) event.preventDefault(); });
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
  async function invoke(action: string, payload: Record<string,unknown> = {}) {
    const {data,error} = await db.functions.invoke('platform-admin',{body:{action,...payload}});
    if (error || data?.error) throw new Error(data?.error || error?.message || 'Internal Files could not load.');
    return data;
  }
  const key = (file: any) => `${file.source || 'n3xra'}:${file.id}`;
  async function publish(file: File): Promise<AssetFile> {
    if (!website || website.id !== getWebsite()?.id) throw new Error('The selected website changed. Reopen Internal Files.');
    return publishAssetFile(db, website, userId, file);
  }
  async function load() {
    if (loaded) return;
    const response = await fetch('/account/admin/files/');
    if (!response.ok) throw new Error('Internal Files could not open.');
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const shell = doc.querySelector('.n3xra-files-shell');
    if (!shell) throw new Error('Internal Files browser is unavailable.');
    const body = dialog.querySelector('.build-files-body')!;
    body.replaceChildren(document.importNode(shell,true));
    for (const modal of doc.querySelectorAll('.n3xra-modal')) body.append(document.importNode(modal,true));
    // Only the file browser is mounted: no page header, navigation, admin loader, or iframe.
    const css = document.createElement('link'); css.rel='stylesheet'; css.href='/account/admin/files/files.css?v=19'; document.head.append(css);
    browser = await import('/account/admin/files/files.js?v=28');
    const context = await getAdminSession();
    await browser.startFiles({supabase:db,session:context.session,invoke,picker:{
      upload: async (files: File[], target: AssetWebsite, category: string) => {
        if (target.id !== website?.id) throw new Error('Upload into this Build Studio website’s folder. Other libraries remain available for browsing.');
        for (const file of files) await publishAssetFile(db,target,userId,file,category ? {category} : {});
      },
      afterUpload: async (record: any, file: File) => { prepared.set(key(record),await publish(file)); },
    }});
    loaded=true;
  }
  document.querySelector<HTMLButtonElement>('#build-upload-files')!.onclick = async () => {
    if (loading) return; website=getWebsite(); if (!website) return;
    dialog.showModal(); loading=true; use.disabled=true; status.textContent='Opening Internal Files…';
    try { await load(); await browser.openInternalFilesFolder(website.id); status.textContent='Browse folders, preview or upload files, then select files to use.'; }
    catch(error) { status.textContent=error instanceof Error?error.message:'Could not open Internal Files.'; }
    finally { loading=false; use.disabled=!loaded; }
  };
  use.onclick = async () => {
    if (!loaded || loading || !website || website.id!==getWebsite()?.id) return;
    const files=browser.selectedInternalFiles(); if (!files.length) {status.textContent='Select one or more files first.';return;}
    loading=true;use.disabled=true;
    try {
      for (const file of files) {
        status.textContent='Preparing '+file.name+'…';
        let asset=prepared.get(key(file));
        const url=file.public_url||file.cdn_url;
        if (!asset && typeof url==='string' && url.startsWith('https://')) asset={id:key(file),name:file.original_filename||file.name.split('/').pop(),publicUrl:url,bucket:'',path:'',mime:file.mime_type||'',size:file.size_bytes||0};
        if (!asset) {
          const download=await browser.internalFileDownload(file);
          const response=await fetch(download.url);if(!response.ok)throw new Error('Could not read '+file.name);
          asset=await publish(new File([await response.blob()],file.original_filename||file.name.split('/').pop(),{type:file.mime_type||''}));prepared.set(key(file),asset);
        }
        if(!attached.some(item=>item.publicUrl===asset!.publicUrl))attached.push(asset);
      }
      render();dialog.close();prompt.focus();
    }catch(error){render();status.textContent=error instanceof Error?error.message:'Could not prepare files.';}
    finally{loading=false;use.disabled=false;}
  };
  return {
    context: () => attached.length ? '\n\nWebsite assets selected for this request (use these public URLs):\n'+JSON.stringify(attached.map(f=>({name:f.name,url:f.publicUrl}))) : '',
    clear: () => {attached=[];render();},
    reset: () => {attached=[];prepared.clear();render();dialog.close();},
  };
}
