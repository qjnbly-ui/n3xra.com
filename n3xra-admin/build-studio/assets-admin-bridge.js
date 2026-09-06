import { FILE_ACCEPT, publishAssetFile } from './asset-library.js';
export function setupAssetsAdminBridge(context) {
    const params = new URLSearchParams(location.search), key = params.get('buildStudio'), websiteId = params.get('website');
    const active = Boolean(key && /^[a-f0-9-]{36}$/.test(key) && websiteId && location.pathname.startsWith('/n3xra-admin/assets'));
    let busy = false;
    const channel = active ? new BroadcastChannel('n3xra-build-assets-' + key) : null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'portal-button';
    button.textContent = 'Use in Build Studio';
    button.disabled = true;
    const status = document.createElement('p');
    status.className = 'portal-inline-status';
    status.setAttribute('role', 'status');
    if (active) {
        document.querySelector('#admin-selected-asset-actions')?.append(button);
        document.querySelector('.website-assets-content-head')?.after(status);
        status.textContent = 'Select files, then choose Use in Build Studio. New uploads are automatically published to the CDN.';
        const input = document.querySelector('#admin-upload-files');
        if (input)
            input.accept = FILE_ACCEPT;
        for (const id of ['open-admin-upload', 'admin-upload-submit']) {
            const el = document.getElementById(id);
            if (el)
                el.textContent = 'Upload files';
        }
        const heading = document.querySelector('#admin-asset-upload-form h3');
        if (heading)
            heading.textContent = 'Add files to this website';
        const label = input?.parentElement?.firstChild;
        if (label?.nodeType === Node.TEXT_NODE)
            label.textContent = 'Choose files (up to 50 MB; photos optimized automatically)';
        const folders = document.querySelector('#admin-upload-category');
        if (folders && !folders.querySelector('option[value="document"]'))
            folders.add(new Option('Documents', 'document'));
        const usage = document.querySelector('#admin-upload-replacement-type');
        if (usage && !usage.querySelector('option[value="download_only"]'))
            usage.add(new Option('Download link', 'download_only'));
        channel.onmessage = event => { if (event.data?.type === 'received') {
            status.textContent = 'Files added to your Build Studio request. You can return to that tab.';
            window.close();
        } };
    }
    button.onclick = async () => {
        if (busy || context.getWebsite()?.id !== websiteId)
            return;
        const selected = context.getSelected();
        if (!selected.length)
            return;
        busy = true;
        button.disabled = true;
        try {
            const files = [];
            for (const version of selected) {
                if (context.getWebsite()?.id !== websiteId)
                    throw new Error('Return to the original website before selecting files.');
                status.textContent = 'Preparing ' + version.original_filename + '…';
                if (!version.public_url && version.status !== 'approved')
                    await context.approve(version.id);
                const publicUrl = version.public_url || await context.publish(version.id);
                files.push({ id: 'version:' + version.id, name: version.original_filename, publicUrl });
            }
            channel.postMessage({ type: 'selected', websiteId, files });
            status.textContent = 'Returning files to Build Studio… Keep its original tab open.';
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : 'Files could not be prepared.';
        }
        finally {
            busy = false;
            refresh();
        }
    };
    function refresh() { button.disabled = busy || context.getWebsite()?.id !== websiteId || !context.getSelected().length; }
    return { active, refresh, upload: async (file, category, replacementType) => {
            const website = context.getWebsite();
            if (!website || website.id !== websiteId)
                throw new Error('Return to the website opened from Build Studio to upload files.');
            return publishAssetFile(context.getDb(), website, context.getUserId(), file, { category, replacementType });
        } };
}
