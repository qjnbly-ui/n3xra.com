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
        <button class="settings-modal-close" type="button" data-speaker-correction-close aria-label="Close speaker correction">Close</button>
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
          <button class="btn" type="submit" data-speaker-correction-save>Save speaker name</button>
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

export function findSpeakerSample(utterances = [], speakerKey, maxDuration = 8) {
  const candidates = utterances
    .filter((utterance) => utterance?.speakerKey === speakerKey)
    .map((utterance) => ({
      start: Number(utterance.start),
      end: Number(utterance.end),
      text: String(utterance.text || "").trim(),
    }))
    .filter((utterance) => Number.isFinite(utterance.start)
      && Number.isFinite(utterance.end)
      && utterance.end > utterance.start)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const selected = candidates[0];
  if (!selected) return null;
  return {
    start: Math.max(0, selected.start),
    end: Math.min(selected.end, selected.start + Math.max(2, maxDuration)),
    text: selected.text,
  };
}

function resetSampleButton(button) {
  if (!button) return;
  button.classList.remove("is-playing");
  button.textContent = "Play sample";
  button.setAttribute("aria-label", `Play voice sample for ${button.dataset.speakerName || "this speaker"}`);
}

export function openSpeakerCorrectionModal({
  speakers = [],
  utterances = [],
  audioElement = null,
  trigger = null,
  onSubmit,
}) {
  const choices = speakers
    .filter((speaker) => speaker?.speakerKey)
    .map((speaker) => ({ ...speaker }));
  if (!choices.length || typeof onSubmit !== "function") return Promise.resolve(false);

  if (activeModalClose) return Promise.resolve(false);
  const modal = document.getElementById("speaker-correction-modal") || createModal();
  const form = modal.querySelector(".speaker-correction-form");
  const options = modal.querySelector("[data-speaker-correction-options]");
  const nameInput = modal.querySelector("[data-speaker-correction-name]");
  const status = modal.querySelector("[data-speaker-correction-status]");
  const saveButton = modal.querySelector("[data-speaker-correction-save]");
  const closeButton = modal.querySelector("[data-speaker-correction-close]");
  const previousFocus = trigger || document.activeElement;
  const controller = new AbortController();
  const { signal } = controller;
  let selectedIndex = 0;
  let isSaving = false;
  let hasSaved = false;
  let activeSampleButton = null;
  let activeSampleEnd = null;
  const originalAudioTime = Number.isFinite(audioElement?.currentTime) ? audioElement.currentTime : 0;

  if (audioElement && !audioElement.paused) audioElement.pause();

  options.replaceChildren();
  choices.forEach((speaker, index) => {
    const row = document.createElement("div");
    row.className = "speaker-correction-option";
    const label = document.createElement("label");
    label.className = "speaker-correction-option-select";

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

    const sample = findSpeakerSample(utterances, speaker.speakerKey);
    const sampleButton = document.createElement("button");
    sampleButton.className = "speaker-correction-sample";
    sampleButton.type = "button";
    sampleButton.textContent = sample ? "Play sample" : "No sample";
    sampleButton.disabled = !sample;
    sampleButton.dataset.speakerSampleIndex = String(index);
    sampleButton.dataset.speakerName = title.textContent;
    sampleButton.setAttribute("aria-label", sample
      ? `Play voice sample for ${title.textContent}`
      : `No voice sample available for ${title.textContent}`);

    label.append(radio, marker, copy);
    row.append(label, sampleButton);
    options.append(row);
  });

  const updateSaveState = () => {
    const displayName = nameInput.value.trim();
    const savedName = String(choices[selectedIndex]?.displayName || `Speaker ${selectedIndex + 1}`).trim();
    saveButton.disabled = isSaving || !displayName || displayName === savedName;
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
    const stopSample = ({ restorePosition = false } = {}) => {
      if (audioElement) {
        audioElement.pause();
        if (restorePosition && Number.isFinite(originalAudioTime)) {
          try {
            audioElement.currentTime = originalAudioTime;
          } catch {
            // The source may still be loading; leaving it paused is safe.
          }
        }
      }
      resetSampleButton(activeSampleButton);
      activeSampleButton = null;
      activeSampleEnd = null;
    };

    const close = () => {
      if (isSaving) return;
      stopSample({ restorePosition: true });
      controller.abort();
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      activeModalClose = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(hasSaved);
    };
    activeModalClose = close;

    options.addEventListener("change", (event) => {
      const radio = event.target.closest('input[name="speaker-correction-choice"]');
      if (radio) {
        stopSample();
        selectSpeaker(Number.parseInt(radio.value, 10), true);
      }
    }, { signal });
    options.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-speaker-sample-index]");
      if (!button || button.disabled) return;
      const index = Number.parseInt(button.dataset.speakerSampleIndex, 10);
      const sample = findSpeakerSample(utterances, choices[index]?.speakerKey);
      if (!sample || !audioElement) return;

      const radio = options.querySelector(`input[name="speaker-correction-choice"][value="${index}"]`);
      if (radio) radio.checked = true;
      if (index !== selectedIndex) selectSpeaker(index);

      if (activeSampleButton === button && !audioElement.paused) {
        stopSample();
        status.textContent = "Voice sample stopped.";
        status.className = "status speaker-correction-status";
        return;
      }
      if (!audioElement.currentSrc && !audioElement.getAttribute("src")) {
        status.textContent = "The recording audio is still loading. Try the sample again in a moment.";
        status.className = "status speaker-correction-status notice";
        return;
      }

      stopSample();
      activeSampleButton = button;
      activeSampleEnd = sample.end;
      button.classList.add("is-playing");
      button.textContent = "Stop sample";
      button.setAttribute("aria-label", `Stop voice sample for ${button.dataset.speakerName}`);
      status.textContent = `Playing a short sample of ${button.dataset.speakerName}.`;
      status.className = "status speaker-correction-status notice";
      try {
        audioElement.currentTime = sample.start;
        await audioElement.play();
      } catch {
        stopSample();
        status.textContent = "The voice sample could not play. Try again after the recording finishes loading.";
        status.className = "status speaker-correction-status error";
      }
    }, { signal });
    audioElement?.addEventListener("timeupdate", () => {
      if (activeSampleEnd !== null && audioElement.currentTime >= activeSampleEnd) {
        stopSample();
        status.textContent = "Voice sample finished.";
        status.className = "status speaker-correction-status";
      }
    }, { signal });
    audioElement?.addEventListener("ended", () => {
      if (!activeSampleButton) return;
      stopSample();
      status.textContent = "Voice sample finished.";
      status.className = "status speaker-correction-status";
    }, { signal });
    nameInput.addEventListener("input", updateSaveState, { signal });
    closeButton.addEventListener("click", close, { signal });
    modal.addEventListener("keydown", (event) => {
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
      const submittedIndex = selectedIndex;
      if (!displayName) {
        status.textContent = "Enter the correct speaker name.";
        status.className = "status speaker-correction-status error";
        nameInput.focus();
        return;
      }

      stopSample();
      isSaving = true;
      saveButton.textContent = "Saving…";
      updateSaveState();
      status.textContent = "Saving speaker correction…";
      status.className = "status speaker-correction-status notice";
      try {
        await onSubmit({
          speaker: choices[submittedIndex],
          speakerKey: choices[submittedIndex].speakerKey,
          displayName,
        });
        isSaving = false;
        hasSaved = true;
        choices[submittedIndex].displayName = displayName;
        const selectedOption = options.children[submittedIndex];
        const selectedTitle = selectedOption?.querySelector(".speaker-correction-option-copy strong");
        const selectedSampleButton = selectedOption?.querySelector("[data-speaker-sample-index]");
        if (selectedTitle) selectedTitle.textContent = displayName;
        if (selectedSampleButton) {
          selectedSampleButton.dataset.speakerName = displayName;
          resetSampleButton(selectedSampleButton);
        }
        saveButton.textContent = "Save speaker name";
        updateSaveState();
        status.textContent = "Speaker name saved. You can correct another speaker or select Close.";
        status.className = "status speaker-correction-status success";
      } catch (error) {
        isSaving = false;
        saveButton.textContent = "Save speaker name";
        updateSaveState();
        status.textContent = error?.message || "Unable to correct the speaker name.";
        status.className = "status speaker-correction-status error";
      }
    }, { signal });

    selectSpeaker(0);
    saveButton.textContent = "Save speaker name";
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => options.querySelector("input:checked")?.focus());
  });
}
