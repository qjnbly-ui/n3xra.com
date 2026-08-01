const SPOKEN_ROUTES = [
  ["/website-request", "Start a Project"],
  ["/website-onboarding", "Website Onboarding"],
  ["/project-workspace", "Project Workspace"],
  ["/client-portal", "Client Portal"],
  ["/ai-music-generator", "AI Music Generator"],
  ["/proposals", "Proposals"],
  ["/records", "Nexra Records"],
  ["/utilities", "Nexra Utilities"],
  ["/virals", "Nexra Virals"],
  ["/account", "Dashboard"],
  ["/partners", "Partners"],
  ["/services", "Services"],
  ["/projects", "Projects"],
  ["/support", "Support"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
];

function cleanSpeechText(value) {
  let text = String(value || "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/\[([^\]]+)]\((?:https?:\/\/|\/)[^)]+\)/gi, "$1")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<\/p\s*>|<\/li\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&nbsp;/gi, " ");

  SPOKEN_ROUTES.forEach(([route, label]) => {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`${escapedRoute}\/?`, "gi"), ` ${label} `);
  });

  return text
    .replace(/\bN3XRA\b/gi, "Nexra")
    .replace(/(\d)[\u00a0\u202f](?=\d{3}\b)/g, "$1,")
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*\/\s*(month|year|week|day|hour)\b/gi, "$1 dollars a $2")
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s+(one-time|one time)\b/gi, "$1 dollar $2")
    .replace(/\$(\d+(?:,\d{3})*(?:\.\d{1,2})?)/g, "$1 dollars")
    .replace(/\b(requests?|documents?|users?|songs?|analyses|credits?|uploads?|files?)\s*\/\s*(month|year|week|day|hour)\b/gi, "$1 a $2")
    .replace(/\s*\/\s*(month|year|week|day|hour)\b/gi, " a $1")
    .replace(/(\d+(?:\.\d+)?)%/g, "$1 percent")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(^|\s)\/[a-z0-9/_-]+/gi, " ")
    .replace(/[→←]/g, ". Then ")
    .replace(/([A-Za-z])[-–]([A-Za-z])/g, "$1 $2")
    .replace(/[•●▪◦]+/g, ". ")
    .replace(/[\*_`#]+/g, "")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

module.exports = { cleanSpeechText };
