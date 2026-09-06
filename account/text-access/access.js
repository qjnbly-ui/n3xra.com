import { createBrowserSupabase, getSessionOrNull } from '/shared/lib/supabase-client.js';
const status = document.querySelector('#status');
const approve = document.querySelector('#approve');
const signin = document.querySelector('#signin');
let token = '';
const client = createBrowserSupabase();
async function request(action) {
    const session = await getSessionOrNull(client);
    if (!session?.access_token) {
        signin.hidden = false;
        throw Error('Sign in to the account registered to your texting number.');
    }
    const r = await fetch('/api/sms-verification', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ token, action }) });
    const data = await r.json();
    if (!r.ok)
        throw Error(data.error);
    return data;
}
async function init() {
    const incoming = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    if (/^[a-f0-9]{64}$/.test(incoming))
        sessionStorage.setItem('nex-text-token', incoming);
    token = sessionStorage.getItem('nex-text-token') || '';
    if (!token)
        throw Error('Text VERIFY to Nex to get a sign-in link.');
    const data = await request('check');
    status.textContent = `Approve account-status replies to your number ending ${data.phoneEnding}?`;
    document.querySelector('#details').hidden = false;
    approve.hidden = false;
}
approve.onclick = async () => {
    approve.disabled = true;
    try {
        const data = await request('approve');
        sessionStorage.removeItem('nex-text-token');
        status.textContent = `Verified until ${new Date(data.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Return to your messages and text “account status” to try it.`;
        approve.hidden = true;
    }
    catch (e) {
        status.textContent = e instanceof Error ? e.message : 'Unable to verify. Text VERIFY for a new link.';
        approve.disabled = false;
    }
};
init().catch(e => { status.textContent = e instanceof Error ? e.message : 'Unable to open this link.'; });
