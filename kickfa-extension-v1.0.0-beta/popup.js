/* ==========================================================================
   KickFa — popup.js
   --------------------------------------------------------------------------
   CHANGES IN v1.3.0:
   - STORAGE_KEY / DEFAULT_SETTINGS now come from shared.js
     (KFA_STORAGE_KEY / KFA_DEFAULT_SETTINGS) instead of being duplicated
     here, so this file, content.js, and background.js can never drift
     out of sync on defaults.
   - New fontPresetSelect wiring: reads/writes settings.fontPreset, and
     applyPreviewStyles() now also sets the 3 --kfa-font-* variables (via
     shared.js's kfaGetFontFamilyVars()) so the Live Preview card actually
     renders in whichever Persian+English pair is currently selected.
   - Defaults changed: fontSize 14 (was 15); fontPreset defaults to
     "vazirmatn-inter".

   Everything else (settings I/O, NipahTV note, Reset) is unchanged.
   ========================================================================== */

(() => {
  "use strict";

  const els = {
    app: document.querySelector(".kfa-app"),
    enabledToggle: document.getElementById("enabledToggle"),
    autoDetectToggle: document.getElementById("autoDetectToggle"),
    fontPresetSelect: document.getElementById("fontPresetSelect"),
    fontSizeSlider: document.getElementById("fontSizeSlider"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    lineHeightSlider: document.getElementById("lineHeightSlider"),
    lineHeightValue: document.getElementById("lineHeightValue"),
    weightGroup: document.getElementById("fontWeightGroup"),
    resetBtn: document.getElementById("resetBtn"),
    nipahNote: document.getElementById("nipahNote"),
    preview: document.getElementById("previewText"),
    status: document.getElementById("statusText"),
  };

  let popupFontFacesInjected = false;

  // fonts.css no longer declares any @font-face rule (see its file header
  // for why) — this injects the same font-face CSS content.js uses for
  // the live page, via the same shared.js helper, so the Live Preview
  // card actually has real fonts to render with.
  function injectPopupFontFaces() {
    if (popupFontFacesInjected) return;
    popupFontFacesInjected = true;

    const style = document.createElement("style");
    style.setAttribute("data-kfa", "font-faces");
    style.textContent = kfaBuildFontFaceCSS();
    document.head.appendChild(style);
  }

  let settings = { ...KFA_DEFAULT_SETTINGS };
  let saveTimer = null;

  /* ------------------------- Rendering helpers ------------------------- */

  function renderUI() {
    els.enabledToggle.checked = settings.enabled;
    els.autoDetectToggle.checked = settings.autoDetect;
    els.fontPresetSelect.value = settings.fontPreset;

    els.fontSizeSlider.value = settings.fontSize;
    els.fontSizeValue.textContent = `${settings.fontSize}px`;

    els.lineHeightSlider.value = settings.lineHeight;
    els.lineHeightValue.textContent = Number(settings.lineHeight).toFixed(1);

    els.weightGroup.querySelectorAll(".kfa-seg-btn").forEach((btn) => {
      btn.classList.toggle(
        "active",
        Number(btn.dataset.weight) === settings.fontWeight
      );
    });

    els.app.classList.toggle("kfa-app-disabled", !settings.enabled);
    applyPreviewStyles();
  }

  function applyPreviewStyles() {
    const root = document.documentElement;
    const fontVars = kfaGetFontFamilyVars(settings.fontPreset);

    root.style.setProperty("--kfa-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--kfa-font-weight", String(settings.fontWeight));
    root.style.setProperty("--kfa-line-height", String(settings.lineHeight));
    root.style.setProperty("--kfa-font-persian-auto", fontVars.persianAuto);
    root.style.setProperty("--kfa-font-persian-full", fontVars.persianFull);
    root.style.setProperty("--kfa-font-english", fontVars.english);
  }

  function flashStatus(message) {
    els.status.textContent = message;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => {
      els.status.textContent = "Settings sync automatically";
    }, 1200);
  }

  // Font Size / Line Height sliders are ALWAYS shown and functional —
  // this only toggles a small informational note, it never hides or
  // disables any control.
  function applyNipahNote(isNipahActive) {
    els.nipahNote.hidden = !isNipahActive;
  }

  /* ------------------------- Storage I/O ------------------------- */

  function loadSettings() {
    chrome.storage.sync.get(KFA_STORAGE_KEY, (result) => {
      settings = { ...KFA_DEFAULT_SETTINGS, ...(result[KFA_STORAGE_KEY] || {}) };
      renderUI();
    });
  }

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.sync.set({ [KFA_STORAGE_KEY]: settings }, () => {
        flashStatus("Saved ✓");
      });
    }, 120);
  }

  /* ------------------------- NipahTV / 7TV detection ------------------------- */

  function checkActiveTabDetection() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id) return;

      chrome.tabs.sendMessage(tab.id, { type: "kfa-get-detection" }, (response) => {
        if (chrome.runtime.lastError) {
          // Not a kick.com tab, or content script hasn't loaded yet.
          return;
        }
        if (response) {
          applyNipahNote(!!response.nipahtv);
        }
      });
    });
  }

  /* ------------------------- Event wiring ------------------------- */

  els.enabledToggle.addEventListener("change", () => {
    settings.enabled = els.enabledToggle.checked;
    renderUI();
    saveSettings();
  });

  els.autoDetectToggle.addEventListener("change", () => {
    settings.autoDetect = els.autoDetectToggle.checked;
    saveSettings();
  });

  els.fontPresetSelect.addEventListener("change", () => {
    settings.fontPreset = els.fontPresetSelect.value;
    renderUI();
    saveSettings();
  });

  els.fontSizeSlider.addEventListener("input", () => {
    settings.fontSize = Number(els.fontSizeSlider.value);
    els.fontSizeValue.textContent = `${settings.fontSize}px`;
    applyPreviewStyles();
    saveSettings();
  });

  els.lineHeightSlider.addEventListener("input", () => {
    settings.lineHeight = Number(els.lineHeightSlider.value);
    els.lineHeightValue.textContent = settings.lineHeight.toFixed(1);
    applyPreviewStyles();
    saveSettings();
  });

  els.weightGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".kfa-seg-btn");
    if (!btn) return;
    settings.fontWeight = Number(btn.dataset.weight);
    renderUI();
    saveSettings();
  });

  els.resetBtn.addEventListener("click", () => {
    settings = { ...KFA_DEFAULT_SETTINGS };
    renderUI();
    saveSettings();
    flashStatus("Reset to defaults ✓");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[KFA_STORAGE_KEY]) return;
    settings = { ...KFA_DEFAULT_SETTINGS, ...changes[KFA_STORAGE_KEY].newValue };
    renderUI();
  });

  injectPopupFontFaces();
  loadSettings();
  checkActiveTabDetection();
})();
