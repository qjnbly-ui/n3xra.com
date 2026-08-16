const controllers = new Set();
const controllerBySelect = new WeakMap();
let sequence = 0;
let rootObserver = null;

function ensureStyles() {
  if (document.querySelector('link[data-admin-select-styles]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/account/admin/admin-select.css?v=4";
  link.dataset.adminSelectStyles = "";
  document.head.append(link);
}

function shouldSkip(select) {
  return select.multiple
    || Number(select.size || 0) > 1
    || select.matches('.account-directory-hidden-select, .support-hidden-select, [aria-hidden="true"][tabindex="-1"]')
    || Boolean(select.closest(".website-admin-native-context"));
}

function fieldLabel(select) {
  const explicit = select.getAttribute("aria-label");
  if (explicit) return explicit;
  const label = select.closest("label");
  const named = label?.querySelector(":scope > span")?.textContent?.trim();
  if (named) return named;
  const directText = [...(label?.childNodes || [])]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent.trim())
    .filter(Boolean)
    .join(" ");
  return directText || select.name || "Choose an option";
}

function closeAll(except = null) {
  controllers.forEach((controller) => {
    if (controller !== except) controller.close();
  });
}

function enhance(select) {
  if (!(select instanceof HTMLSelectElement) || controllerBySelect.has(select) || shouldSkip(select)) return;
  const id = `admin-select-${++sequence}`;
  const wrapper = document.createElement("span");
  wrapper.className = "admin-select";
  const trigger = document.createElement("button");
  trigger.className = "admin-select-trigger";
  trigger.type = "button";
  trigger.id = `${id}-trigger`;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-menu`);
  trigger.setAttribute("aria-label", fieldLabel(select));
  trigger.innerHTML = '<span></span><i aria-hidden="true"></i>';
  const menu = document.createElement("div");
  menu.className = "admin-select-menu";
  menu.id = `${id}-menu`;
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-labelledby", trigger.id);
  menu.setAttribute("popover", "manual");
  menu.hidden = true;
  const owningDialog = select.closest("dialog");
  (owningDialog || document.body).append(menu);
  wrapper.append(trigger);
  select.insertAdjacentElement("afterend", wrapper);
  select.classList.add("admin-native-select");
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;

  function options() {
    return [...menu.querySelectorAll('[role="option"]')];
  }

  function render() {
    const selectedOption = select.selectedOptions[0] || select.options[0];
    trigger.querySelector("span").textContent = selectedOption?.textContent?.trim() || "Choose an option";
    trigger.disabled = select.disabled || !select.options.length;
    menu.replaceChildren(...[...select.options].map((nativeOption) => {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.dataset.value = nativeOption.value;
      option.disabled = nativeOption.disabled;
      option.setAttribute("aria-selected", String(nativeOption === selectedOption));
      const text = document.createElement("span");
      text.textContent = nativeOption.textContent.trim();
      const check = document.createElement("i");
      check.setAttribute("aria-hidden", "true");
      option.append(text, check);
      return option;
    }));
  }

  function positionMenu() {
    const rect = trigger.getBoundingClientRect();
    const gutter = 10;
    const menuGap = 6;
    const preferredHeight = 360;
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - (gutter * 2));
    const left = Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter));
    const spaceBelow = window.innerHeight - rect.bottom - gutter - menuGap;
    const spaceAbove = rect.top - gutter - menuGap;
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(120, placeAbove ? spaceAbove : spaceBelow);
    menu.style.left = `${left}px`;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.min(preferredHeight, availableHeight)}px`;
    menu.style.top = placeAbove ? "auto" : `${rect.bottom + menuGap}px`;
    menu.style.bottom = placeAbove ? `${window.innerHeight - rect.top + menuGap}px` : "auto";
  }

  function close({ focus = false } = {}) {
    if (typeof menu.hidePopover === "function" && menu.matches(":popover-open")) menu.hidePopover();
    menu.hidden = true;
    wrapper.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    if (focus && trigger.isConnected) trigger.focus();
  }

  function open(focusIndex = null) {
    if (trigger.disabled) return;
    closeAll(controller);
    render();
    positionMenu();
    menu.hidden = false;
    if (typeof menu.showPopover === "function") menu.showPopover();
    wrapper.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    if (Number.isInteger(focusIndex)) {
      const available = options();
      const index = Math.max(0, Math.min(focusIndex, available.length - 1));
      requestAnimationFrame(() => available[index]?.focus());
    }
  }

  function choose(value) {
    if (select.value === value) {
      close({ focus: true });
      return;
    }
    select.value = value;
    render();
    close({ focus: true });
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const controller = { select, wrapper, trigger, menu, render, close };
  controllers.add(controller);
  controllerBySelect.set(select, controller);
  render();

  trigger.addEventListener("click", () => menu.hidden ? open() : close());
  trigger.addEventListener("focus", render);
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const available = options();
    const selectedIndex = Math.max(0, available.findIndex((option) => option.getAttribute("aria-selected") === "true"));
    const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : selectedIndex + (event.key === "ArrowDown" ? 1 : -1);
    open(index);
  });
  menu.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option && !option.disabled) choose(option.dataset.value);
  });
  menu.addEventListener("keydown", (event) => {
    const available = options().filter((option) => !option.disabled);
    const current = available.indexOf(event.target.closest('[role="option"]'));
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close({ focus: event.key === "Escape" });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : current + (event.key === "ArrowDown" ? 1 : -1);
    available[Math.max(0, Math.min(index, available.length - 1))]?.focus();
  });
  menu.addEventListener("wheel", (event) => {
    const atTop = menu.scrollTop <= 0 && event.deltaY < 0;
    const atBottom = menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 1 && event.deltaY > 0;
    if (atTop || atBottom) event.preventDefault();
    event.stopPropagation();
  }, { passive: false });
  owningDialog?.addEventListener("close", () => close());
  select.addEventListener("change", render);
  select.addEventListener("invalid", () => trigger.focus());
  const selectObserver = new MutationObserver(render);
  selectObserver.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "selected", "label"] });
  controller.observer = selectObserver;
}

function scan(root) {
  if (root instanceof HTMLSelectElement) enhance(root);
  root.querySelectorAll?.("select").forEach(enhance);
}

function prune() {
  controllers.forEach((controller) => {
    if (controller.select.isConnected) return;
    controller.observer?.disconnect();
    controller.menu.remove();
    controller.wrapper.remove();
    controllers.delete(controller);
  });
}

export function initializeAdminSelects(root = document) {
  ensureStyles();
  scan(root);
  if (rootObserver || root !== document) return;
  rootObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }));
    prune();
  });
  rootObserver.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", (event) => {
    controllers.forEach((controller) => {
      if (!controller.wrapper.contains(event.target) && !controller.menu.contains(event.target)) controller.close();
    });
  });
  document.addEventListener("reset", (event) => {
    setTimeout(() => event.target.querySelectorAll?.("select").forEach((select) => controllerBySelect.get(select)?.render()));
  }, true);
  window.addEventListener("resize", () => closeAll());
  document.addEventListener("scroll", (event) => {
    if (event.target instanceof Element && event.target.closest(".admin-select-menu")) return;
    closeAll();
  }, true);
}
