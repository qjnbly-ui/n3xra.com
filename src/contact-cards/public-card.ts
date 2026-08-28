interface CardLink {
  label: string;
  url: string;
}

interface ContactCard {
  slug: string;
  display_name: string;
  headline: string;
  company_name: string;
  bio: string;
  email: string | null;
  additional_emails: string[];
  phone_e164: string | null;
  additional_phones: string[];
  website_url: string | null;
  location_text: string;
  links: CardLink[];
  section_order: Array<"about" | "contact" | "links">;
  accent_color: string;
  show_n3xra_branding: boolean;
  exchange_enabled: boolean;
  media: {
    profile: boolean;
    logo: boolean;
    background: boolean;
  };
}

let activeCard: ContactCard | null = null;

const byId = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing card element: ${id}`);
  return value as T;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function slugFromLocation(): string {
  const querySlug = new URLSearchParams(window.location.search).get("slug");
  if (querySlug) return text(querySlug).toLowerCase();
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[0] === "card" ? text(parts[1]).toLowerCase() : "";
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "N3";
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
    : value;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function linkIcon(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("") : label.slice(0, 2).toUpperCase();
}

function addLink(container: HTMLElement, label: string, detail: string, url: string): void {
  const href = safeUrl(url);
  if (!href) return;
  const link = document.createElement("a");
  link.className = "contact-card-link";
  link.href = href;
  if (href.startsWith("http")) {
    link.target = "_blank";
    link.rel = "noopener";
  }
  const icon = document.createElement("span");
  icon.className = "contact-card-link-icon";
  icon.textContent = linkIcon(label);
  const copy = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = label;
  const small = document.createElement("small");
  small.textContent = detail;
  copy.append(strong, small);
  const arrow = document.createElement("span");
  arrow.className = "contact-card-link-arrow";
  arrow.textContent = "›";
  arrow.setAttribute("aria-hidden", "true");
  link.append(icon, copy, arrow);
  container.append(link);
}

function vCard(card: ContactCard): string {
  const escaped = (value: string) => value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escaped(card.display_name)}`,
    card.company_name ? `ORG:${escaped(card.company_name)}` : "",
    card.headline ? `TITLE:${escaped(card.headline)}` : "",
    ...[card.email, ...(card.additional_emails || [])].filter(Boolean).map((email) => `EMAIL;TYPE=INTERNET:${email}`),
    ...[card.phone_e164, ...(card.additional_phones || [])].filter(Boolean).map((phone) => `TEL;TYPE=CELL:${phone}`),
    card.website_url ? `URL:${card.website_url}` : "",
    card.location_text ? `ADR;TYPE=WORK:;;;;;;${escaped(card.location_text)}` : "",
    `NOTE:${escaped(`Digital contact card: ${window.location.href}`)}`,
    "END:VCARD",
  ];
  return lines.filter(Boolean).join("\r\n");
}

function downloadContact(card: ContactCard): void {
  const blob = new Blob([vCard(card)], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${card.slug}.vcf`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function render(card: ContactCard): void {
  activeCard = card;
  document.documentElement.style.setProperty("--card-accent", card.accent_color || "#2f7d68");
  document.title = `${card.display_name} | Digital contact card`;
  byId("card-initials").textContent = initials(card.display_name);
  byId("card-company").textContent = card.company_name;
  byId("card-name").textContent = card.display_name;
  byId("card-headline").textContent = card.headline;
  byId("card-location").textContent = card.location_text;

  const mediaUrl = (type: "profile" | "logo" | "background") => `/api/contact-card-media?slug=${encodeURIComponent(card.slug)}&type=${type}`;
  if (card.media?.profile) {
    const image = byId<HTMLImageElement>("card-profile-image");
    image.src = mediaUrl("profile");
    image.alt = card.display_name;
    image.hidden = false;
    byId("card-initials").hidden = true;
  }
  if (card.media?.logo) {
    const logo = byId<HTMLImageElement>("card-logo");
    logo.src = mediaUrl("logo");
    logo.alt = card.company_name ? `${card.company_name} logo` : "Company logo";
    logo.hidden = false;
  }
  if (card.media?.background) {
    const background = byId<HTMLImageElement>("card-background");
    background.src = mediaUrl("background");
    background.hidden = false;
  }

  const actions = byId("card-primary-actions");
  if (card.phone_e164) {
    const call = document.createElement("a");
    call.href = `tel:${card.phone_e164}`;
    call.textContent = "Call";
    actions.append(call);
  }
  const save = document.createElement("button");
  save.type = "button";
  save.className = "is-primary";
  save.textContent = "Save contact";
  save.addEventListener("click", () => downloadContact(card));
  actions.append(save);
  if (!card.phone_e164) actions.style.gridTemplateColumns = "1fr";

  const connectButton = byId<HTMLButtonElement>("card-connect-button");
  connectButton.hidden = card.exchange_enabled === false;

  if (card.bio) {
    byId("card-bio").textContent = card.bio;
    byId("card-about-section").hidden = false;
  }

  const contactLinks = byId("card-contact-links");
  if (card.email) addLink(contactLinks, "Email", card.email, `mailto:${card.email}`);
  for (const email of card.additional_emails || []) addLink(contactLinks, "Email", email, `mailto:${email}`);
  if (card.phone_e164) addLink(contactLinks, "Phone", formatPhone(card.phone_e164), `tel:${card.phone_e164}`);
  for (const phone of card.additional_phones || []) addLink(contactLinks, "Phone", formatPhone(phone), `tel:${phone}`);
  if (card.website_url) addLink(contactLinks, "Website", new URL(card.website_url).hostname.replace(/^www\./, ""), card.website_url);
  byId("card-contact-section").hidden = contactLinks.children.length === 0;

  const links = byId("card-links");
  for (const item of card.links || []) addLink(links, text(item.label), text(item.url).replace(/^https?:\/\//, ""), text(item.url));
  byId("card-custom-links-section").hidden = links.children.length === 0;

  const order = Array.isArray(card.section_order) ? card.section_order : ["about", "contact", "links"];
  for (const [index, key] of order.entries()) {
    const section = document.querySelector<HTMLElement>(`[data-card-section="${key}"]`);
    if (section) section.style.order = String(index);
  }

  byId("card-branding-footer").hidden = card.show_n3xra_branding === false;

  byId("card-loading").hidden = true;
  byId("contact-card").hidden = false;
}

function openConnectDialog(): void {
  if (!activeCard) return;
  const dialog = byId<HTMLDialogElement>("card-connect-dialog");
  byId("card-connect-intro").textContent = `Share your contact information with ${activeCard.display_name}.`;
  byId("card-connect-disclosure").textContent = `Your details will be shared with ${activeCard.display_name} and stored in their private N3XRA Contacts.`;
  byId("card-connect-fields").hidden = false;
  byId("card-connect-success").hidden = true;
  byId("card-connect-status").textContent = "";
  const footer = dialog.querySelector<HTMLElement>("footer");
  if (footer) footer.hidden = false;
  dialog.showModal();
  window.setTimeout(() => dialog.querySelector<HTMLInputElement>('input[name="name"]')?.focus(), 50);
}

function closeConnectDialog(): void {
  byId<HTMLDialogElement>("card-connect-dialog").close();
}

async function submitConnection(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  if (!activeCard) return;
  const form = event.currentTarget as HTMLFormElement;
  const submit = byId<HTMLButtonElement>("card-connect-submit");
  const status = byId("card-connect-status");
  const values = new FormData(form);
  submit.disabled = true;
  status.textContent = "Sharing…";
  status.className = "contact-card-connect-status";
  try {
    const response = await fetch("/api/contact-card-connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: activeCard.slug,
        name: values.get("name"),
        email: values.get("email"),
        phone: values.get("phone"),
        company: values.get("company"),
        message: values.get("message"),
        website: values.get("website"),
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Your information could not be shared.");
    form.reset();
    byId("card-connect-fields").hidden = true;
    byId("card-connect-success").hidden = false;
    const footer = byId<HTMLDialogElement>("card-connect-dialog").querySelector<HTMLElement>("footer");
    if (footer) footer.hidden = true;
    window.setTimeout(closeConnectDialog, 2200);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Your information could not be shared.";
    status.className = "contact-card-connect-status is-error";
  } finally {
    submit.disabled = false;
  }
}

byId<HTMLButtonElement>("card-connect-button").addEventListener("click", openConnectDialog);
byId<HTMLButtonElement>("card-connect-close").addEventListener("click", closeConnectDialog);
byId<HTMLButtonElement>("card-connect-cancel").addEventListener("click", closeConnectDialog);
byId<HTMLFormElement>("card-connect-form").addEventListener("submit", (event) => void submitConnection(event));
byId<HTMLDialogElement>("card-connect-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeConnectDialog();
});

async function initialize(): Promise<void> {
  const slug = slugFromLocation();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("This card address is not valid.");
  const response = await fetch(`/api/contact-card?slug=${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({})) as { card?: ContactCard; error?: string };
  if (!response.ok || !body.card) throw new Error(body.error || "This digital card is not published right now.");
  render(body.card);
}

void initialize().catch((error: unknown) => {
  byId("card-loading").hidden = true;
  byId("card-error-message").textContent = error instanceof Error ? error.message : "This digital card is not available.";
  byId("card-error").hidden = false;
});
