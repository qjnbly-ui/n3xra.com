(() => {
  document.documentElement.classList.add("reveal-ready");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const header = document.querySelector("[data-home-header]");
  const menuToggle = document.querySelector("[data-site-menu-toggle]");
  const menu = menuToggle
    ? document.getElementById(menuToggle.getAttribute("aria-controls") || "")
    : null;
  const navBrand = document.querySelector(".home-topbar .home-brand");
  const heroLogo = document.querySelector(".hero-logo");

  function revealNavBrand() {
    document.documentElement.classList.remove("nav-brand-transfer-pending");
  }

  async function transferNavBrand() {
    if (
      reduceMotion
      || !document.documentElement.classList.contains("nav-brand-transfer-pending")
      || !navBrand
      || !heroLogo
      || typeof navBrand.animate !== "function"
    ) {
      revealNavBrand();
      return;
    }

    const sourceRect = heroLogo.getBoundingClientRect();
    const targetRect = navBrand.getBoundingClientRect();
    const headerHeight = header?.getBoundingClientRect().height || 0;
    const sourceIsVisible = sourceRect.bottom > headerHeight && sourceRect.top < window.innerHeight;

    if (
      document.hidden
      || !sourceIsVisible
      || sourceRect.width <= 0
      || targetRect.width <= 0
    ) {
      revealNavBrand();
      return;
    }

    const flightBrand = navBrand.cloneNode(true);
    flightBrand.classList.add("nav-brand-flight");
    flightBrand.removeAttribute("href");
    flightBrand.setAttribute("aria-hidden", "true");
    Object.assign(flightBrand.style, {
      left: `${targetRect.left}px`,
      top: `${targetRect.top}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
    });
    document.body.appendChild(flightBrand);

    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const deltaX = sourceCenterX - targetCenterX;
    const deltaY = sourceCenterY - targetCenterY;
    const startScale = Math.max(1.35, Math.min(1.75, (sourceRect.width / targetRect.width) * 0.34));

    const flight = flightBrand.animate([
      {
        opacity: 0.12,
        clipPath: "inset(0 78% 0 0 round 999px)",
        filter: "blur(3px) drop-shadow(0 0 10px rgba(35, 199, 244, 0.16))",
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${startScale})`,
        offset: 0,
      },
      {
        opacity: 0.32,
        clipPath: "inset(0 58% 0 0 round 999px)",
        filter: "blur(2px) drop-shadow(0 0 13px rgba(35, 199, 244, 0.2))",
        transform: `translate3d(${deltaX * 0.75}px, ${deltaY * 0.75}px, 0) scale(${1 + (startScale - 1) * 0.75})`,
        offset: 0.25,
      },
      {
        opacity: 0.56,
        clipPath: "inset(0 34% 0 0 round 999px)",
        filter: "blur(1px) drop-shadow(0 0 14px rgba(35, 199, 244, 0.24))",
        transform: `translate3d(${deltaX * 0.5}px, ${deltaY * 0.5}px, 0) scale(${1 + (startScale - 1) * 0.5})`,
        offset: 0.5,
      },
      {
        opacity: 0.82,
        clipPath: "inset(0 12% 0 0 round 999px)",
        filter: "blur(0.35px) drop-shadow(0 0 10px rgba(35, 199, 244, 0.2))",
        transform: `translate3d(${deltaX * 0.25}px, ${deltaY * 0.25}px, 0) scale(${1 + (startScale - 1) * 0.25})`,
        offset: 0.75,
      },
      {
        opacity: 1,
        clipPath: "inset(0 0 0 0 round 999px)",
        filter: "blur(0) drop-shadow(0 0 0 rgba(35, 199, 244, 0))",
        transform: "translate3d(0, 0, 0) scale(1)",
        offset: 1,
      },
    ], {
      duration: 2600,
      easing: "cubic-bezier(0.22, 0.7, 0.18, 1)",
      fill: "both",
    });

    try {
      await flight.finished;
    } catch {
      // Reveal the real brand if the flight is interrupted.
    } finally {
      revealNavBrand();
      flightBrand.remove();
    }
  }

  if (document.documentElement.classList.contains("nav-brand-transfer-pending")) {
    window.setTimeout(transferNavBrand, 7200);
  } else {
    revealNavBrand();
  }

  function updateHeader() {
    header?.classList.toggle("is-scrolled", window.scrollY > 20);
  }

  function syncMenuLabel() {
    if (!menuToggle) return;
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  }

  function closeMenu({ restoreFocus = false } = {}) {
    if (!menuToggle || !menu) return;
    menu.classList.remove("is-open");
    menu.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Open menu");
    document.body.classList.remove("site-menu-is-open");
    if (restoreFocus) menuToggle.focus();
  }

  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  menuToggle?.addEventListener("click", () => {
    window.requestAnimationFrame(syncMenuLabel);
  });

  menu?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => closeMenu());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
      closeMenu({ restoreFocus: true });
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900 && menuToggle?.getAttribute("aria-expanded") === "true") {
      closeMenu();
    }
  });

  const revealTargets = Array.from(document.querySelectorAll("[data-reveal]"));

  if (!("IntersectionObserver" in window) || reduceMotion) {
    revealTargets.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -8% 0px",
    threshold: 0.12,
  });

  revealTargets.forEach((element) => observer.observe(element));
})();

(() => {
  const gallery = document.querySelector(".work-proof-gallery");
  const projects = gallery ? Array.from(gallery.querySelectorAll(".work-proof-project")) : [];
  const mobileView = window.matchMedia("(max-width: 700px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!gallery || projects.length < 2 || reduceMotion) return;

  const clones = projects.map((project) => {
    const clone = project.cloneNode(true);
    clone.classList.add("work-proof-clone");
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("tabindex", "-1");
    gallery.appendChild(clone);
    return clone;
  });

  let galleryIsVisible = false;
  let animationFrame;
  let resumeTimer;
  let previousTime = 0;
  let scrollPosition = 0;
  const pixelsPerSecond = 36;

  function stopAutoplay() {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    previousTime = 0;
  }

  function loopWidth() {
    return clones[0].offsetLeft - projects[0].offsetLeft;
  }

  function moveGallery(time) {
    if (!previousTime) previousTime = time;
    const elapsed = Math.min(time - previousTime, 50);
    previousTime = time;
    scrollPosition += pixelsPerSecond * (elapsed / 1000);

    const width = loopWidth();
    if (width > 0 && scrollPosition >= width) {
      scrollPosition -= width;
    }

    gallery.scrollLeft = scrollPosition;
    animationFrame = window.requestAnimationFrame(moveGallery);
  }

  function startAutoplay() {
    stopAutoplay();
    if (!mobileView.matches || !galleryIsVisible || document.hidden) return;
    scrollPosition = gallery.scrollLeft;
    animationFrame = window.requestAnimationFrame(moveGallery);
  }

  function resumeAutoplayLater() {
    window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(startAutoplay, 2200);
  }

  gallery.addEventListener("pointerdown", () => {
    stopAutoplay();
    window.clearTimeout(resumeTimer);
  });
  gallery.addEventListener("pointerup", resumeAutoplayLater);
  gallery.addEventListener("pointercancel", resumeAutoplayLater);
  gallery.addEventListener("focusin", stopAutoplay);
  gallery.addEventListener("focusout", resumeAutoplayLater);

  if ("IntersectionObserver" in window) {
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      galleryIsVisible = entry.isIntersecting;
      if (galleryIsVisible) startAutoplay();
      else stopAutoplay();
    }, { threshold: 0.35 });
    visibilityObserver.observe(gallery);
  } else {
    galleryIsVisible = true;
    startAutoplay();
  }

  const handleMobileViewChange = () => {
    if (!mobileView.matches) {
      stopAutoplay();
      scrollPosition = 0;
      gallery.scrollTo({ left: 0, behavior: "auto" });
      return;
    }
    startAutoplay();
  };

  if (typeof mobileView.addEventListener === "function") {
    mobileView.addEventListener("change", handleMobileViewChange);
  } else {
    mobileView.addListener(handleMobileViewChange);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoplay();
    else startAutoplay();
  });
})();

(() => {
  const form = document.getElementById("ask-form");
  const input = document.getElementById("ask-input");
  const submit = document.getElementById("ask-submit");
  const status = document.getElementById("ask-status");
  const answer = document.getElementById("ask-answer");
  const chatHistory = [];
  const maxHistoryMessages = 10;

  if (!form || !input || !submit || !status || !answer) return;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderAnswer(text) {
    let html = escapeHtml(text);
    html = html.replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/gi, "<strong>$1</strong>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(
      /\b(https?:\/\/[^\s<]+)/gi,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    const routes = [
      ["/ai-music-generator/", "AI Music Generator"],
      ["/virals/", "N3XRA Virals"],
      ["/utilities/", "N3XRA Utilities"],
      ["/records/", "N3XRA Records"],
      ["/services/", "Services"],
      ["/projects/", "Projects"],
      ["/support/", "Support"],
      ["/terms/", "Terms"],
      ["/privacy/", "Privacy"],
    ];

    routes.forEach(([route, label]) => {
      const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(^|[\\s(])${escapedRoute}?(?=[\\s).,!?;:]|$)`, "gi");
      html = html.replace(pattern, `$1<a class="ask-route-link" href="${route}">${label}</a>`);
    });

    return html.replace(/\n/g, "<br>");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    answer.hidden = true;
    answer.innerHTML = "";
    status.textContent = "";

    if (!question) {
      status.textContent = "Enter a question first.";
      return;
    }

    submit.disabled = true;
    submit.textContent = "Thinking...";

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: chatHistory }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        status.textContent = data?.error ? String(data.error) : "Unable to get an answer right now.";
        return;
      }

      const answerText = String(data.answer || "").trim();
      answer.innerHTML = renderAnswer(answerText);
      answer.hidden = !answerText;

      if (answerText) {
        chatHistory.push({ role: "user", content: question });
        chatHistory.push({ role: "assistant", content: answerText });
        if (chatHistory.length > maxHistoryMessages) {
          chatHistory.splice(0, chatHistory.length - maxHistoryMessages);
        }
        input.value = "";
        input.focus();
      }
    } catch {
      status.textContent = "Request failed. Please try again.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Ask";
    }
  });
})();
