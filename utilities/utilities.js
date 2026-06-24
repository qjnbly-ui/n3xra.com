(function () {
  const loginForm = document.getElementById("utilities-login-form");
  const loginStatus = document.getElementById("utilities-login-status");
  const onboardingForm = document.getElementById("utilities-onboarding-form");
  const onboardingStatus = document.getElementById("utilities-onboarding-status");
  const MAX_LOGO_BYTES = 2 * 1024 * 1024;
  const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(new Error("Unable to read logo file.")));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image));
      image.addEventListener("error", () => reject(new Error("Unable to read logo colors.")));
      image.src = dataUrl;
    });
  }

  function rgbToHex(color) {
    return `#${[color.r, color.g, color.b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
  }

  function colorDistance(a, b) {
    return Math.sqrt(((a.r - b.r) ** 2) + ((a.g - b.g) ** 2) + ((a.b - b.b) ** 2));
  }

  function colorSaturation(color) {
    const max = Math.max(color.r, color.g, color.b);
    const min = Math.min(color.r, color.g, color.b);
    return max ? (max - min) / max : 0;
  }

  async function extractPalette(dataUrl) {
    try {
      const image = await loadImage(dataUrl);
      const canvas = document.createElement("canvas");
      const maxSize = 80;
      const scale = Math.min(maxSize / image.naturalWidth, maxSize / image.naturalHeight, 1) || 1;
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return {};
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const buckets = new Map();
      for (let index = 0; index < pixels.length; index += 16) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const a = pixels[index + 3];
        if (a < 128) continue;
        if (r > 245 && g > 245 && b > 245) continue;
        if (r < 20 && g < 20 && b < 20) continue;

        const key = `${Math.round(r / 32)}-${Math.round(g / 32)}-${Math.round(b / 32)}`;
        const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        bucket.count += 1;
        buckets.set(key, bucket);
      }

      const colors = Array.from(buckets.values())
        .map((bucket) => ({
          r: bucket.r / bucket.count,
          g: bucket.g / bucket.count,
          b: bucket.b / bucket.count,
          count: bucket.count,
        }))
        .sort((a, b) => (b.count * (1 + colorSaturation(b))) - (a.count * (1 + colorSaturation(a))));

      const primary = colors[0] || null;
      const secondary = colors.find((color) => primary && colorDistance(primary, color) > 80) || colors[1] || null;
      return {
        primary_color: primary ? rgbToHex(primary) : undefined,
        secondary_color: secondary ? rgbToHex(secondary) : undefined,
      };
    } catch {
      return {};
    }
  }

  async function addLogoFilePayload(form, payload) {
    const fileInput = form.querySelector('input[name="logo_file"]');
    const file = fileInput?.files?.[0] || null;
    if (!file) return payload;
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      throw new Error("Logo must be a PNG, JPG, WebP, or SVG file.");
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw new Error("Logo file must be 2 MB or smaller.");
    }
    const dataUrl = await readFileAsDataUrl(file);
    const palette = await extractPalette(dataUrl);

    return {
      ...payload,
      ...palette,
      logo_file: {
        name: file.name || "utility-logo",
        type: file.type,
        size: file.size,
        data_url: dataUrl,
      },
    };
  }

  function formToPayload(form) {
    const data = new FormData(form);
    const payload = {};
    for (const [key, value] of data.entries()) {
      if (value instanceof File) continue;
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        payload[key] = Array.isArray(payload[key]) ? payload[key].concat(value) : [payload[key], value];
      } else {
        payload[key] = value;
      }
    }

    payload.wants_stripe_connect = true;

    for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
      if (checkbox.disabled && checkbox.checked) {
        payload[checkbox.name] = true;
        continue;
      }
      if (!checkbox.checked && !Object.prototype.hasOwnProperty.call(payload, checkbox.name)) {
        payload[checkbox.name] = false;
      }
    }

    return payload;
  }

  if (loginForm && loginStatus) {
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(loginForm);
      const email = String(data.get("email") || "").trim() || "this account";
      loginStatus.textContent = `Preview only: portal login for ${email} will be connected when authentication is wired.`;
      loginStatus.classList.add("is-active");
    });
  }

  if (onboardingForm && onboardingStatus) {
    onboardingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = formToPayload(onboardingForm);
      const provider = String(payload.provider_name || "").trim() || "your utility";
      onboardingStatus.textContent = "Creating utility setup...";
      onboardingStatus.classList.remove("is-active", "is-error");

      try {
        const body = await addLogoFilePayload(onboardingForm, payload);
        const response = await fetch("/api/utilities-onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result?.error || "Unable to send onboarding request.");
        }
        onboardingForm.reset();
        onboardingStatus.textContent = `${provider} setup created. Reserved portal: ${result.domain || result.slug || "pending"}.`;
        onboardingStatus.classList.add("is-active");
      } catch (error) {
        onboardingStatus.textContent = error instanceof Error ? error.message : "Unable to send onboarding request.";
        onboardingStatus.classList.add("is-error");
      }
    });
  }
})();
