import { prepareCdnImage } from '../../shared/lib/cdn-image-optimizer.js';
const PRIVATE = 'website-assets-private';
const PUBLIC = 'website-assets-public';
export const FILE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
export const FILE_ACCEPT = Object.keys(FILE_TYPES).map(ext => '.' + ext).join(',');
export function fileMime(name, size) {
    if (size > 50 * 1024 * 1024)
        throw new Error(`${name} is larger than 50 MB.`);
    const mime = FILE_TYPES[name.split('.').pop()?.toLowerCase() || ''];
    if (!mime)
        throw new Error(`${name}: choose an image, PDF, document, spreadsheet, ZIP, or text file.`);
    return mime;
}
function check(result) { if (result.error)
    throw new Error(result.error.message || 'The file could not be saved.'); return result.data; }
export async function listAssetFiles(db, website) {
    if (!website.organization_id)
        throw new Error('Connect this website to an organization to use its files.');
    const [privateResult, sitesResult] = await Promise.all([
        db.from('organization_files').select('id,display_name,original_filename,storage_bucket,storage_path,mime_type,size_bytes').eq('organization_id', website.organization_id).order('updated_at', { ascending: false }),
        db.from('client_websites').select('id').eq('organization_id', website.organization_id),
    ]);
    const files = check(privateResult).filter((f) => f.storage_bucket && f.storage_path).map((f) => ({ id: 'file:' + f.id, name: f.original_filename || f.display_name, bucket: f.storage_bucket, path: f.storage_path, mime: f.mime_type || '', size: f.size_bytes || 0 }));
    const siteIds = check(sitesResult).map((s) => s.id);
    if (!siteIds.length)
        return files;
    const assets = check(await db.from('website_assets').select('id,label').in('website_id', siteIds).eq('status', 'active'));
    if (!assets.length)
        return files;
    const versions = check(await db.from('website_asset_versions').select('id,storage_bucket,storage_path,original_filename,mime_type,size_bytes,public_url,status').in('asset_id', assets.map((a) => a.id)).in('status', ['draft', 'pending_review', 'approved', 'published']).order('created_at', { ascending: false }));
    return [...files, ...versions.map((v) => ({ id: 'version:' + v.id, name: v.original_filename, bucket: v.storage_bucket, path: v.storage_path, mime: v.mime_type || '', size: v.size_bytes || 0, ...(v.status === 'published' && v.public_url ? { publicUrl: v.public_url } : {}) }))];
}
// A new website asset preserves the source and appears in the organization's existing Files & Assets library.
export async function publishAssetFile(db, website, userId, file, options = {}) {
    if (!website.organization_id)
        throw new Error('This website needs an organization.');
    const mime = fileMime(file.name, file.size);
    const category = options.category || (mime.startsWith('image/') ? (/(^|[\s._-])(logo|icon|favicon|wordmark)([\s._-]|$)/i.test(file.name) ? 'logo' : 'image') : 'document');
    const replacement = options.replacementType || (mime.startsWith('image/') ? 'html_src' : 'download_only');
    const prepared = await prepareCdnImage(file, { category, replacement_type: replacement }, { mime_type: mime, original_filename: file.name });
    if (prepared.blob.size > 50 * 1024 * 1024)
        throw new Error('The prepared file is larger than 50 MB.');
    const id = crypto.randomUUID(), versionId = crypto.randomUUID();
    const name = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-160) || 'file';
    const path = `${website.id}/${id}/v1-${name}`;
    let assetCreated = false, originalUploaded = false, published = false;
    try {
        check(await db.from('website_assets').insert({ id, website_id: website.id, asset_key: 'build-' + id, label: file.name.slice(0, 180), category, replacement_type: replacement, created_by_user_id: userId }));
        assetCreated = true;
        check(await db.storage.from(PRIVATE).upload(path, file, { contentType: mime, upsert: false }));
        originalUploaded = true;
        const now = new Date().toISOString();
        check(await db.from('website_asset_versions').insert({ id: versionId, asset_id: id, version_number: 1, status: 'approved', storage_bucket: PRIVATE, storage_path: path, original_filename: file.name, mime_type: mime, size_bytes: file.size, uploaded_by_user_id: userId, approved_by_user_id: userId, approved_at: now, change_note: 'Added through Build Studio' }));
        check(await db.storage.from(PUBLIC).upload(path, prepared.blob, { contentType: prepared.contentType, cacheControl: '31536000', upsert: false }));
        published = true;
        const url = db.storage.from(PUBLIC).getPublicUrl(path).data.publicUrl;
        check(await db.from('website_asset_versions').update({ status: 'published', public_url: url, cdn_size_bytes: prepared.blob.size, cdn_mime_type: prepared.contentType, cdn_width: prepared.width, cdn_height: prepared.height, cdn_optimized: prepared.optimized, cdn_processed_at: now, published_by_user_id: userId, published_at: now }).eq('id', versionId));
        check(await db.from('website_assets').update({ current_version_id: versionId }).eq('id', id));
        return { id: 'version:' + versionId, name: file.name, bucket: PRIVATE, path, mime, size: file.size, publicUrl: url };
    }
    catch (error) {
        const cleanup = [];
        if (published)
            cleanup.push(db.storage.from(PUBLIC).remove([path]));
        if (originalUploaded)
            cleanup.push(db.storage.from(PRIVATE).remove([path]));
        // Deleting the new asset cascades its version; no existing asset is modified.
        if (assetCreated)
            cleanup.push(db.from('website_assets').delete().eq('id', id));
        const results = await Promise.allSettled(cleanup);
        if (results.some(r => r.status === 'rejected' || r.value?.error))
            throw new Error('Upload failed and cleanup was incomplete. Check Files & Assets before retrying.');
        throw error;
    }
}
export async function useAssetFile(db, website, userId, file) {
    fileMime(file.name, file.size);
    if (file.publicUrl && /^https:\/\//.test(file.publicUrl))
        return file;
    const blob = check(await db.storage.from(file.bucket).download(file.path));
    return publishAssetFile(db, website, userId, new File([blob], file.name, { type: file.mime }));
}
