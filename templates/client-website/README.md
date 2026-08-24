# N3XRA Client Website Starter

This is a deployable Astro starter used for private N3XRA website previews. Run `npm install` and `npm run build` to verify the static site before publishing template changes.

The provisioning workflow supplies the approved website name, public logo, colors, fonts, and portal URL as preview-only Vercel environment variables. The page uses neutral N3XRA defaults whenever optional branding is unavailable and tells search engines not to index the preview.

Use `PortalSignInLink.astro` for the client-facing portal entry link. The component intentionally does not accept a `target` property, so the website is replaced by the branded portal in the same browser tab.

```astro
---
import PortalSignInLink from "./components/PortalSignInLink.astro";

const portalUrl = "https://business-name.portal.n3xra.com/";
---

<PortalSignInLink href={portalUrl} />
```

Do not replace this component with `window.open()` or add `target="_blank"`. The portal provides its own same-tab return link back to the client website.
