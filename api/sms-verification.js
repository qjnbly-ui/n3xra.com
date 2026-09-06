"use strict";
const _sms_verification_1 = require("./_sms-verification");
const { authenticatedUser, getCallerAccount, getCredentialByUser } = require("./_account-phone");
const { latestConsent } = require("./_sms-consent");
async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed.' });
    try {
        const user = await authenticatedUser(req);
        if (!user?.id)
            return res.status(401).json({ error: 'Sign in to continue.' });
        const credential = await getCredentialByUser(user.id);
        const caller = credential?.phone_e164 ? await getCallerAccount(credential.phone_e164) : null;
        if (caller?.user_id !== user.id)
            return res.status(403).json({ error: 'Set up a phone number on your active N3XRA account first.' });
        if ((await latestConsent(credential.phone_e164))?.event_type !== 'opt_in')
            return res.status(403).json({ error: 'Text START to Nex to enable requested text replies, then text VERIFY.' });
        if (!['check', 'approve'].includes(req.body?.action))
            return res.status(400).json({ error: 'Choose whether to approve this text conversation.' });
        return res.status(200).json(await (0, _sms_verification_1.verifySmsLink)(String(req.body?.token || ''), user.id, undefined, undefined, Date.now(), req.body.action === 'approve'));
    }
    catch {
        return res.status(400).json({ error: 'This link is unavailable, expired, already used, or belongs to another account. Text VERIFY for a new link.' });
    }
}
module.exports = handler;
