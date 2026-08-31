(() => {
  const header = document.querySelector("[data-cards-header]");
  const revealItems = [...document.querySelectorAll("[data-reveal]")];
  const projects = {
    fire: { name: "Medford Fire Assignment", resources: ["☼|Fire Weather Briefing", "⌁|Radio Channels", "⌖|Division Map"] },
    training: { name: "Crew Training Resources", resources: ["▶|Training Video", "DOC|Safety Checklist", "✓|Completion Form"] },
    equipment: { name: "Equipment Inspection", resources: ["⌖|Inspection Diagram", "DOC|Service Manual", "✓|Submit Inspection"] },
  };

  const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 20);
  const showProject = (key) => {
    const project = projects[key];
    if (!project) return;
    const name = document.querySelector("#demo-project-name");
    const resources = document.querySelector("#demo-resources");
    if (name) name.textContent = project.name;
    if (resources) resources.innerHTML = project.resources.map((item) => {
      const [icon, label] = item.split("|");
      return `<span><b>${icon}</b> ${label}</span>`;
    }).join("");
    document.querySelectorAll("[data-demo-project]").forEach((button) => button.classList.toggle("is-active", button.dataset.demoProject === key));
  };

  document.querySelectorAll("[data-demo-project]").forEach((button) => button.addEventListener("click", () => showProject(button.dataset.demoProject || "fire")));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) revealItems.forEach((item) => item.classList.add("is-visible"));
  else {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }), { rootMargin: "0px 0px -10%", threshold: .1 });
    revealItems.forEach((item) => observer.observe(item));
  }
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });
})();
