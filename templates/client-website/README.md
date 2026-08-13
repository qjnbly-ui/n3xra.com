# N3XRA Client Website Starter

Use `PortalSignInLink.astro` for the client-facing portal entry link. The component intentionally does not accept a `target` property, so the website is replaced by the branded portal in the same browser tab.

```astro
---
import PortalSignInLink from "./components/PortalSignInLink.astro";

const portalUrl = "https://business-name.portal.n3xra.com/";
---

<PortalSignInLink href={portalUrl} />
```

Do not replace this component with `window.open()` or add `target="_blank"`. The portal provides its own same-tab return link back to the client website.
