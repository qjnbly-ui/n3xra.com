let activeModalClose = null;

function createModal() {
  const modal = document.createElement("div");
  modal.className = "confirm-modal speaker-correction-modal";
  modal.id = "speaker-correction-modal";
  modal.setAttribute("aria-hidden", "true");
  modal.innerHTML = `
    <section class="confirm-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="speaker-correction-title" aria-describedby="speaker-correction-copy">
      <header class="confirm-modal-header">
        <div>
          <p class="confirm-modal-kicker">Meeting transcript</p>
          <h2 class="confirm-modal-title" id="speaker-correction-title">Correct speaker name</h2>
        </div>
        <button class="modal-close" type="button" data-speaker-correction-close aria-label="Close speaker correction">Close</button>
      </header>
      <form class="confirm-modal-body speaker-correction-form" novalidate>
        <p class="confirm-modal-copy" id="speaker-correction-copy">Choose a speaker, then enter the name that should appear throughout this transcript.</p>
        <fieldset class="speaker-correction-fieldset">
          <legend>Choose a speaker</legend>
          <div class="speaker-correction-options" data-speaker-correction-options></div>
        </fieldset>
        <div class="field speaker-correction-name-field">
          <label for="speaker-correction-name">Correct name</label>
          <input id="speaker-correction-name" data-speaker-correction-name type="text" maxlength="120" autocomplete="name" required>
          <small class="field-note">This name will replace the selected speaker label everywhere in this meeting.</small>
        </div>
        <p class="status speaker-correction-status" data-speaker-correction-status role="status" aria-live="polite"></p>
        <div class="confirm-modal-actions">
          <button class="btn secondary" type="button" data-speaker-correction-cancel>Cancel</button>
          <button class="btn" type="submit" data-speaker-correction-save>Save correction</button>
        </div>
      </form>
    </section>
  `;
  document.body.append(modal);
  return modal;
}

function getFocusableElements(modal) {
  return [...modal.querySelectorAll("button:not([disabled]), input:not([disabled])")]
    .filter((element) => element.offsetParent !== null);
}

function formatSpeakerNote(speaker) {
  if (speaker?.userId) return "Matched voice profile";
  return "Detected in this meeting";
}

export function openSpeakerCorrectionModal({ speakers = [], trigger = null, onSubmit }) {
  const choices = speakers.filter((speaker) => speaker?.speakerKey);
  if (!choices.length || typeof onSubmit !== "function") return Promise.resolve(false);

  if (activeModalClose) return Promise.resolve(false);
  const modal = document.getElementById("speaker-correction-modal") || createModal();
  const form = modal.querySelector(".speaker-correction-form");
  const options = modal.querySelector("[data-speaker-correction-options]");
  const nameInput = modal.querySelector("[data-speaker-correction-name]");
  const status = modal.querySelector("[data-speaker-correction-status]");
  const saveButton = modal.querySelector("[data-speaker-correction-save]");
  const cancelButton = modal.querySelector("[data-speaker-correction-cancel]");
  const closeButton = modal.querySelector("[data-speaker-correction-close]");
  const previousFocus = trigger || document.activeElement;
  const controller = new AbortController();
  const { signal } = controller;
  let selectedIndex = 0;
  let isSaving = false;

  options.replaceChildren();
  choices.forEach((speaker, index) => {
    const label = document.createElement("label");
    label.className = "speaker-correction-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "speaker-correction-choice";
    radio.value = String(index);
    radio.checked = index === 0;

    const marker = document.createElement("span");
    marker.className = "speaker-correction-marker";
    marker.textContent = String(index + 1);
    marker.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "speaker-correction-option-copy";
    const title = document.createElement("strong");
    title.textContent = speaker.displayName || `Speaker ${index + 1}`;
    const note = document.createElement("small");
    note.textContent = formatSpeakerNote(speaker);
    copy.append(title, note);

    label.append(radio, marker, copy);
    options.append(label);
  });

  const updateSaveState = () => {
    saveButton.disabled = isSaving || !nameInput.value.trim();
  };

  const selectSpeaker = (index, focusName = false) => {
    selectedIndex = index;
    nameInput.value = choices[index]?.displayName || `Speaker ${index + 1}`;
    status.textContent = "";
    status.className = "status speaker-correction-status";
    updateSaveState();
    if (focusName) {
      nameInput.focus();
      nameInput.select();
    }
  };

  return new Promise((resolve) => {
    const close = (saved = false) => {
      if (isSaving && !saved) return;
      controller.abort();
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      activeModalClose = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(saved);
    };
    activeModalClose = close;

    options.addEventListener("change", (event) => {
      const radio = event.target.closest('input[name="speaker-correction-choice"]');
      if (radio) selectSpeaker(Number.parseInt(radio.value, 10), true);
    }, { signal });
    nameInput.addEventListener("input", updateSaveState, { signal });
    cancelButton.addEventListener("click", () => close(false), { signal });
    closeButton.addEventListener("click", () => close(false), { signal });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close(false);
    }, { signal });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(modal);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }, { signal });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const displayName = nameInput.value.trim();
      if (!displayName) {
        status.textContent = "Enter the correct speaker name.";
        status.className = "status speaker-correction-status error";
        nameInput.focus();
        return;
      }

      isSaving = true;
      saveButton.textContent = "Saving…";
      updateSaveState();
      status.textContent = "Saving speaker correction…";
      status.className = "status speaker-correction-status notice";
      try {
        await onSubmit({
          speaker: choices[selectedIndex],
          speakerKey: choices[selectedIndex].speakerKey,
          displayName,
        });
        isSaving = false;
        close(true);
      } catch (error) {
        isSaving = false;
        saveButton.textContent = "Save correction";
        updateSaveState();
        status.textContent = error?.message || "Unable to correct the speaker name.";
        status.className = "status speaker-correction-status error";
      }
    }, { signal });

    selectSpeaker(0);
    saveButton.textContent = "Save correction";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => options.querySelector("input:checked")?.focus());
  });
}
