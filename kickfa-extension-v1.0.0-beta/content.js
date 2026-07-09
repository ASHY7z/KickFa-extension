/* ==========================================================================
   KickFa — content.js
   --------------------------------------------------------------------------
   CHANGES IN v1.3.0:

   1. Font preset system. STORAGE_KEY / DEFAULT_SETTINGS now come from
      shared.js (KFA_STORAGE_KEY / KFA_DEFAULT_SETTINGS), which adds a
      `fontPreset` field (e.g. "vazirmatn-inter"). applySettingsToPage()
      resolves that preset to 3 CSS custom properties on :root
      (--kfa-font-persian-auto, --kfa-font-persian-full,
      --kfa-font-english) via shared.js's kfaGetFontFamilyVars(). Neither
      fonts.css nor buildShadowFontCSS()'s rules need to know which
      preset is active — they just consume whichever family names those
      variables currently hold. buildShadowFontCSS() now declares
      @font-face rules for all 4 shipped families (looped from
      shared.js's KFA_FONT_FILES) instead of only Vazirmatn.

   2. Disable-toggle bug fix (2 parts):
        a) EXCLUDE_FROM_STYLING's long `:not(i):not(svg)...` chain gave
           the "enabled" shadow-DOM rules higher CSS specificity than the
           kill-switch meant to override them — so like the light-DOM
           bug fixed in fonts.css, the toggle worked on the tagged row
           itself but not on any of its descendants (i.e. no visible
           text actually changed). Fixed the same way: the exclusion
           chain is now wrapped in `:not(:where(...))`, which matches
           identically but contributes ZERO specificity.
        b) The chat INPUT box has a second, JS-side half of this bug:
           refreshEditableFont() applies its font via INLINE
           `style.setProperty(..., "important")`, and an inline
           `!important` always outranks even an `!important` rule in an
           external stylesheet — so the CSS kill-switch alone could
           never revert an input box that already had inline styles
           applied. Previously refreshEditableFont() only re-ran on
           actual input events (typing/focus/click), so toggling
           Disable while NOT actively interacting with the chat box left
           the stale inline font behind. Fixed by adding
           refreshAllEditableFonts(), called from the
           chrome.storage.onChanged listener on every settings change —
           this also keeps the input box in sync immediately when font
           size/weight/preset changes, not just on the next keystroke.

   3. Font-face loading bug fix (v1.3.0 follow-up). fonts.css used to
      declare @font-face rules itself, with relative paths like
      `url("fonts/Vazirmatn-Regular.woff2")`. On the live site those were
      observed resolving against kick.com's own origin instead of the
      extension's — the browser requested
      https://kick.com/fonts/Vazirmatn-Regular.woff2 and got a 404, so no
      custom font ever actually loaded. fonts.css no longer contains any
      @font-face rule at all. Every font file is now loaded exclusively
      through chrome.runtime.getURL(), which always produces a
      fully-qualified chrome-extension://<id>/fonts/... URL regardless of
      context: injectLightDomFontFaces() below handles the page (light
      DOM), buildShadowFontCSS() handles shadow roots, and popup.js has
      its own equivalent for the Live Preview card — all three call the
      same kfaBuildFontFaceCSS() helper in shared.js.

   Everything else — root-scoped MutationObservers, shadow-root
   discovery, no text-node splitting, single .kfa-farsi class per row,
   the descend-into-bulk-containers scanNode fix, the broadened
   MESSAGE_ROW_SELECTOR / EXCLUDE_FROM_STYLING matching set for
   quote/reply content — is unchanged.
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Constants                                                        *
   * ------------------------------------------------------------------ */

  const FARSI_REGEX =
    /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  // Light-DOM chat CONTAINER candidates. Compound entries (client keyword +
  // "chat") avoid matching a client's entire top-level app-shell element.
  const CHAT_ROOT_SELECTORS = [
    "#chatroom",
    '[data-testid="chatroom"]',
    ".chatroom",
    "#chat-room",
    ".chat-room",
    '[class*="nipah" i][class*="chat" i]',
    '[id*="nipah" i][id*="chat" i]',
    '[class*="seventv" i][class*="chat" i]',
    '[id*="seventv" i][id*="chat" i]',
    '[class*="chat-messages" i]',
    '[class*="chat-list" i]',
    '[class*="message-list" i]',
  ];

  // Elements that might HOST a shadow root containing 7TV's actual chat UI.
  // Safe to keep broader than CHAT_ROOT_SELECTORS: entering an isolated
  // shadow tree can't leak styling to the rest of the page.
  const SHADOW_HOST_SELECTOR =
    "seventv-container, seventv-chat-list, seventv-message, seventv-chat, " +
    '[class*="seventv" i], [id*="seventv" i], [class*="7tv" i], [id*="7tv" i], ' +
    '[class*="nipah" i], [id*="nipah" i]';

  // A single message row — username and text together. Also matches
  // reply/quote preview blocks, so a quoted message gets recognized (and
  // tagged) as its own unit even when it isn't simply nested inside an
  // already-tagged row. Only ever queried inside an already-confirmed chat
  // root, so it's safe to keep broad.
  const MESSAGE_ROW_SELECTOR =
    '.chat-line, .message, .chat-message, [class*="message" i], ' +
    '[class*="chat-entry" i], [class*="chat-line" i], [class*="chat-row" i], ' +
    '[class*="reply" i], [class*="quote" i], [class*="quoted" i]';

  const CHAT_INPUT_SELECTOR =
    '[class*="chat-input" i], [class*="message-input" i], [class*="chat-editor" i], ' +
    '[class*="editor" i], [class*="textbox" i], [role="textbox"], ' +
    '[placeholder*="message" i], [placeholder*="chat" i]';

  const EDITABLE_SELECTOR =
    'input[type="text"], textarea, [contenteditable="true"], [contenteditable=""], ' +
    '[role="textbox"], [data-slate-editor="true"], [class*="editor" i]';

  const INPUT_EVENTS = [
    "beforeinput",
    "input",
    "keydown",
    "keyup",
    "paste",
    "compositionupdate",
    "compositionend",
    "focusin",
    "click",
  ];

  // Things that should never resize/reweight even inside a tagged message
  // row: icons, form controls, timestamps. `a`/`button` and badge-like
  // elements are deliberately NOT excluded — 7TV often renders real text
  // such as @mentions or reply chips through those wrappers; a quoted-reply
  // preview or a mention link is legitimate text content that should still
  // get styled, only actual icon-only elements need protecting.
  //
  // Wrapped in :not(:where(...)) rather than a chain of separate :not()
  // clauses — see file header, fix #2a. :where() always has ZERO
  // specificity, so this exclusion no longer out-specs the disable
  // kill-switch, while still matching exactly the same elements.
  const EXCLUDE_FROM_STYLING =
    ':not(:where(i, svg, path, img, input, select, option, time, ' +
    '[class*="icon" i], [class*="timestamp" i]))';

  /* ------------------------------------------------------------------ *
   * 2. State                                                            *
   * ------------------------------------------------------------------ */

  let settings = { ...KFA_DEFAULT_SETTINGS };
  let detected = { nipahtv: false, seventv: false };

  const chatRoots = new Set();
  const inputWatcherRoots = new WeakSet();

  /* ------------------------------------------------------------------ *
   * 3. Settings: load, persist, apply                                   *
   * ------------------------------------------------------------------ */

  function loadSettings(callback) {
    chrome.storage.sync.get(KFA_STORAGE_KEY, (result) => {
      settings = { ...KFA_DEFAULT_SETTINGS, ...(result[KFA_STORAGE_KEY] || {}) };
      if (callback) callback();
    });
  }

  function applySettingsToPage() {
    const root = document.documentElement;
    if (!root) return;

    const fontVars = kfaGetFontFamilyVars(settings.fontPreset);

    root.style.setProperty("--kfa-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--kfa-font-weight", String(settings.fontWeight));
    root.style.setProperty("--kfa-line-height", String(settings.lineHeight));
    root.style.setProperty("--kfa-font-persian-auto", fontVars.persianAuto);
    root.style.setProperty("--kfa-font-persian-full", fontVars.persianFull);
    root.style.setProperty("--kfa-font-english", fontVars.english);

    root.classList.toggle("kfa-disabled", !settings.enabled);

    // 7TV renders replies, mentions, bot messages, and normal chat text
    // through several different wrappers. Relying on per-row Farsi tagging
    // misses parts of that tree, so when KickFa is enabled we font the whole
    // discovered chat/shadow area. The master enable switch remains the
    // actual on/off control.
    root.classList.toggle("kfa-force-all", settings.enabled);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[KFA_STORAGE_KEY]) return;

    const wasEnabled = settings.enabled;
    const wasAutoDetect = settings.autoDetect;

    settings = { ...KFA_DEFAULT_SETTINGS, ...changes[KFA_STORAGE_KEY].newValue };
    applySettingsToPage();

    // Bug fix (disable toggle, part b — see file header). Without this,
    // a chat input box that already had inline `!important` font styles
    // applied kept them until its next input event, since inline
    // !important beats even an !important stylesheet rule. Also keeps
    // the input in sync immediately on any font/size/weight/preset
    // change, not just Enable/Disable.
    refreshAllEditableFonts();

    const justEnabled = settings.enabled && !wasEnabled;
    const justTurnedOnAutoDetect = settings.autoDetect && !wasAutoDetect;
    if (settings.enabled && settings.autoDetect && (justEnabled || justTurnedOnAutoDetect)) {
      rescanAllRoots();
    }
  });

  /* ------------------------------------------------------------------ *
   * 4. Font-face injection — light DOM (page) AND shadow roots           *
   *    BUG FIX (v1.3.0, follow-up): every @font-face src now comes      *
   *    exclusively from kfaBuildFontFaceCSS() (shared.js), which        *
   *    resolves each file through chrome.runtime.getURL() into an       *
   *    absolute chrome-extension://<id>/fonts/....woff2 URL. fonts.css  *
   *    itself no longer declares any @font-face rule with a relative    *
   *    url("fonts/...") path — that pattern was observed resolving      *
   *    against kick.com's own origin (https://kick.com/fonts/...) once  *
   *    the stylesheet actually ran on the live site, producing 404s.    *
   *    chrome.runtime.getURL() sidesteps that entirely and behaves      *
   *    identically in every context (page, shadow root, popup).         *
   * ------------------------------------------------------------------ */

  let lightDomFontFacesInjected = false;

  // Injects the @font-face rules directly into the page (light DOM /
  // NipahTV). Guarded so it only ever runs once per frame — "all_frames":
  // true means this content script (and this function) runs separately
  // per-frame already, which is correct/intended, this guard just stops a
  // second call within the SAME frame from adding a duplicate <style>.
  function injectLightDomFontFaces() {
    if (lightDomFontFacesInjected) return;
    lightDomFontFacesInjected = true;

    const style = document.createElement("style");
    style.setAttribute("data-kfa", "font-faces");
    style.textContent = kfaBuildFontFaceCSS();

    // documentElement always exists even at document_start; document.head
    // may not exist yet at this point, so don't wait on it — a <style>
    // element applies its rules regardless of where in the document it
    // lives.
    (document.head || document.documentElement).appendChild(style);
  }

  function buildShadowFontCSS() {
    return `
      ${kfaBuildFontFaceCSS()}

      /* Smart mode: only rows explicitly tagged .kfa-farsi get styled.
         English variable listed FIRST so English words inside a
         Farsi/reply message render in the selected English font rather
         than the Persian face's own Latin glyphs — Inter/IBM Plex Sans
         have no Persian glyphs, so Persian text still correctly falls
         through to the Persian face right after it. */
      .kfa-farsi,
      .kfa-farsi *${EXCLUDE_FROM_STYLING} {
        font-family: var(--kfa-font-english), var(--kfa-font-persian-auto), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: var(--kfa-font-weight, 400) !important;
        font-size: var(--kfa-font-size, 14px) !important;
        line-height: var(--kfa-line-height, 1.5) !important;
      }

      .kfa-vazir-input {
        font-family: var(--kfa-font-english), var(--kfa-font-persian-full), var(--kfa-font-persian-auto), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: var(--kfa-font-weight, 400) !important;
        font-size: var(--kfa-font-size, 14px) !important;
        line-height: var(--kfa-line-height, 1.5) !important;
      }

      .kfa-vazir-input.kfa-rtl-input {
        direction: rtl !important;
        text-align: right !important;
        unicode-bidi: plaintext !important;
      }

      /* Force-All mode: style EVERYTHING in this shadow tree, tagged or
         not. Safe to use a bare "*" here — this stylesheet is injected
         INTO the shadow root, so it can only ever affect this shadow
         tree's own content, never anything outside it. :host-context()
         lets this shadow-scoped stylesheet react to the .kfa-force-all
         class living on <html>, OUTSIDE the shadow boundary. */
      :host-context(html.kfa-force-all) *${EXCLUDE_FROM_STYLING} {
        font-family: var(--kfa-font-english), var(--kfa-font-persian-full), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-weight: var(--kfa-font-weight, 400) !important;
        font-size: var(--kfa-font-size, 14px) !important;
        line-height: var(--kfa-line-height, 1.5) !important;
      }

      /* Master kill-switch — reverts everything in this shadow tree,
         regardless of which mode was active. The exclusion list above
         is now zero-specificity (fix #2a) and this selector is doubled
         (.kfa-disabled.kfa-disabled) for a defensive edge, so it always
         wins rather than depending on source order. Declared last too,
         as a second line of defense. */
      :host-context(html.kfa-disabled.kfa-disabled) * {
        font-family: inherit !important;
        font-weight: inherit !important;
        font-size: inherit !important;
        line-height: inherit !important;
      }
    `;
  }

  function injectShadowFontStyle(shadowRoot) {
    try {
      const style = document.createElement("style");
      style.setAttribute("data-kfa", "shadow-font");
      style.textContent = buildShadowFontCSS();
      shadowRoot.appendChild(style);
    } catch (err) {
      // Non-fatal — worst case this one shadow root doesn't get the font.
    }
  }

  /* ------------------------------------------------------------------ *
   * 5. Tagging                                                           *
   * ------------------------------------------------------------------ */

  function isInsideAnyChatRoot(el) {
    if (!el) return false;
    for (const root of chatRoots) {
      if (root.isConnected && root.contains(el)) return true;
    }
    return false;
  }

  function tagRowIfFarsi(row) {
    if (!row || row.classList.contains("kfa-farsi")) return;
    if (FARSI_REGEX.test(row.textContent)) row.classList.add("kfa-farsi");
  }

  function scanNode(node) {
    if (!settings.enabled || !settings.autoDetect || chatRoots.size === 0) return;

    const target = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!target || !target.closest) return;
    if (!isInsideAnyChatRoot(target)) return;

    // Case 1: the node itself is a row (or a quote/reply block), or sits
    // inside one — this is the path live, one-at-a-time messages take.
    const row = target.closest(MESSAGE_ROW_SELECTOR);
    if (row && isInsideAnyChatRoot(row)) {
      tagRowIfFarsi(row);
    }

    // Case 2: the node is a CONTAINER holding one or more rows (or quote
    // blocks) as descendants — how bulk/historical loads, and some
    // reply/quote structures, tend to arrive. closest() can't see this;
    // querySelectorAll can.
    if (target.nodeType === Node.ELEMENT_NODE && target.querySelectorAll) {
      target.querySelectorAll(MESSAGE_ROW_SELECTOR).forEach((nestedRow) => {
        if (isInsideAnyChatRoot(nestedRow)) tagRowIfFarsi(nestedRow);
      });
    }

    // Fallback for markup that doesn't match our row pattern at all.
    if (!row && target.nodeType === Node.ELEMENT_NODE && target.children.length === 0) {
      tagRowIfFarsi(target);
    }
  }

  function rescanAllRoots() {
    for (const root of chatRoots) {
      if (root.isConnected) {
        root.querySelectorAll(MESSAGE_ROW_SELECTOR).forEach(tagRowIfFarsi);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 6. Root discovery — light-DOM containers AND shadow-root hosts       *
   * ------------------------------------------------------------------ */

  function attachObserverToRoot(root, isShadow) {
    if (chatRoots.has(root)) return;
    chatRoots.add(root);
    attachInputWatcherToRoot(root);

    if (isShadow) {
      injectShadowFontStyle(root);
    } else {
      root.classList.add("kfa-chat-root");
    }

    const observer = new MutationObserver(handleMutations);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const sweepThisRoot = () => {
      if (root.isConnected) {
        root.querySelectorAll(MESSAGE_ROW_SELECTOR).forEach(tagRowIfFarsi);
      }
    };
    sweepThisRoot();
    [300, 800, 1500, 3000].forEach((ms) => setTimeout(sweepThisRoot, ms));
  }

  function findChatRootCandidates() {
    const found = [];
    for (const sel of CHAT_ROOT_SELECTORS) {
      let matches;
      try {
        matches = document.querySelectorAll(sel);
      } catch (err) {
        continue;
      }
      matches.forEach((el) => {
        if (el && el !== document.body && el !== document.documentElement) {
          found.push(el);
        }
      });
    }
    return found;
  }

  function findShadowHostCandidates() {
    const hosts = [];
    try {
      document.querySelectorAll(SHADOW_HOST_SELECTOR).forEach((el) => {
        if (el.shadowRoot) hosts.push(el.shadowRoot);
      });
    } catch (err) {
      // ignore
    }
    return hosts;
  }

  function maybeDiscoverNestedShadowHost(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    if (
      node.shadowRoot &&
      !chatRoots.has(node.shadowRoot) &&
      node.matches &&
      node.matches(SHADOW_HOST_SELECTOR)
    ) {
      attachObserverToRoot(node.shadowRoot, true);
    }

    if (!node.querySelectorAll) return;
    node.querySelectorAll(SHADOW_HOST_SELECTOR).forEach((el) => {
      if (el.shadowRoot && !chatRoots.has(el.shadowRoot)) {
        attachObserverToRoot(el.shadowRoot, true);
      }
    });
  }

  function ensureChatRoots() {
    for (const root of chatRoots) {
      if (!root.isConnected) chatRoots.delete(root);
    }

    findChatRootCandidates().forEach((el) => {
      if (!chatRoots.has(el)) attachObserverToRoot(el, false);
    });

    findShadowHostCandidates().forEach((shadowRoot) => {
      if (!chatRoots.has(shadowRoot)) attachObserverToRoot(shadowRoot, true);
    });
  }

  function startChatRootWatch() {
    ensureChatRoots();

    let attempts = 0;
    const fastRetry = setInterval(() => {
      attempts += 1;
      ensureChatRoots();
      if (attempts >= 20) clearInterval(fastRetry);
    }, 500);

    setInterval(ensureChatRoots, 5000);

    [1500, 4000, 8000].forEach((ms) => setTimeout(rescanAllRoots, ms));
  }

  /* ------------------------------------------------------------------ *
   * 7. MutationObserver callback — one instance shared by every root     *
   * ------------------------------------------------------------------ */

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        maybeDiscoverNestedShadowHost(node);

        if (
          settings.enabled &&
          settings.autoDetect &&
          (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE)
        ) {
          scanNode(node);
        }
      }

      if (
        settings.enabled &&
        settings.autoDetect &&
        mutation.type === "characterData" &&
        mutation.target
      ) {
        scanNode(mutation.target);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 8. Live typing support — restricted to the actual chat input only    *
   * ------------------------------------------------------------------ */

  function isChatInputElement(el) {
    if (!el) return false;
    if (el.matches && el.matches(CHAT_INPUT_SELECTOR)) return true;
    if (el.closest && el.closest(CHAT_INPUT_SELECTOR)) return true;
    return isInsideAnyChatRoot(el);
  }

  function getEditableText(el) {
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      return el.value || "";
    }
    return el.textContent || "";
  }

  // NOTE: the "kfa-vazir-input" class name is historical (kept for
  // backwards compatibility / minimal diff) — it now applies whichever
  // Persian+English pair is currently selected, not specifically Vazir.
  function refreshEditableFont(el) {
    if (!el || !el.classList || !el.style) return;

    if (!settings.enabled) {
      el.classList.remove("kfa-vazir-input");
      el.classList.remove("kfa-rtl-input");
      el.style.removeProperty("font-family");
      el.style.removeProperty("font-weight");
      el.style.removeProperty("font-size");
      el.style.removeProperty("line-height");
      el.style.removeProperty("direction");
      el.style.removeProperty("text-align");
      el.style.removeProperty("unicode-bidi");
      return;
    }

    const isFarsi = FARSI_REGEX.test(getEditableText(el));
    const shouldUseVazir = true;

    el.classList.toggle("kfa-vazir-input", shouldUseVazir);
    el.classList.toggle("kfa-rtl-input", isFarsi);

    if (shouldUseVazir) {
      // References the same --kfa-font-* variables fonts.css/
      // buildShadowFontCSS() use, so the input box always matches
      // whatever preset is currently selected. var() works fine inside
      // an inline style value.
      el.style.setProperty(
        "font-family",
        "var(--kfa-font-english), var(--kfa-font-persian-full), var(--kfa-font-persian-auto), " +
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        "important"
      );
      el.style.setProperty("font-weight", String(settings.fontWeight), "important");
      el.style.setProperty("font-size", `${settings.fontSize}px`, "important");
      el.style.setProperty("line-height", String(settings.lineHeight), "important");
    } else {
      el.style.removeProperty("font-family");
      el.style.removeProperty("font-weight");
      el.style.removeProperty("font-size");
      el.style.removeProperty("line-height");
    }

    if (isFarsi) {
      el.style.setProperty("direction", "rtl", "important");
      el.style.setProperty("text-align", "right", "important");
      el.style.setProperty("unicode-bidi", "plaintext", "important");
    } else {
      el.style.removeProperty("direction");
      el.style.removeProperty("text-align");
      el.style.removeProperty("unicode-bidi");
    }
  }

  function onEditableEvent(e) {
    let el = e.target && e.target.closest ? e.target.closest(EDITABLE_SELECTOR) : null;

    if (!el && typeof e.composedPath === "function") {
      for (const node of e.composedPath()) {
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches && node.matches(EDITABLE_SELECTOR)) {
            el = node;
            break;
          }
          if (node.isContentEditable) {
            el = node;
            break;
          }
        }
      }
    }

    if (el && isChatInputElement(el)) {
      refreshEditableFont(el);
      setTimeout(() => refreshEditableFont(el), 0);
    }
  }

  function refreshEditableFontsInRoot(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll(EDITABLE_SELECTOR).forEach((el) => {
      if (isChatInputElement(el)) refreshEditableFont(el);
    });

    if (root.activeElement && isChatInputElement(root.activeElement)) {
      refreshEditableFont(root.activeElement);
    }
  }

  // Bug fix (disable toggle, part b — see file header). Re-runs the
  // input-font logic for the document AND every known chat/shadow root,
  // so a settings change (Enable/Disable, preset, size, weight, line
  // height) is reflected on the chat input immediately, instead of only
  // on its next keystroke/focus/click event.
  function refreshAllEditableFonts() {
    refreshEditableFontsInRoot(document);
    for (const root of chatRoots) {
      if (root.isConnected) refreshEditableFontsInRoot(root);
    }
  }

  function attachInputWatcherToRoot(root) {
    if (!root || inputWatcherRoots.has(root)) return;
    inputWatcherRoots.add(root);

    INPUT_EVENTS.forEach((eventName) => {
      root.addEventListener(eventName, onEditableEvent, true);
    });

    refreshEditableFontsInRoot(root);
    setTimeout(() => refreshEditableFontsInRoot(root), 300);
    setTimeout(() => refreshEditableFontsInRoot(root), 1200);
  }

  function startInputWatcher() {
    attachInputWatcherToRoot(document);
  }

  /* ------------------------------------------------------------------ *
   * 9. NipahTV / 7TV detection (best-effort, for the popup's benefit)    *
   * ------------------------------------------------------------------ */

  function detectChatClient() {
    const nipahtv = !!(
      document.querySelector('[class*="nipah" i], [id*="nipah" i]') ||
      window.NipahTV ||
      document.querySelector('script[src*="nipah" i]')
    );

    const seventv = !!(
      document.querySelector('[class*="seventv" i], [id*="seventv" i], seventv-container') ||
      window.seventv ||
      document.querySelector('script[src*="7tv" i], script[src*="seventv" i]')
    );

    detected = { nipahtv, seventv };
  }

  function startDetection() {
    detectChatClient();
    const delays = [1000, 3000, 6000, 10000];
    delays.forEach((ms) => setTimeout(detectChatClient, ms));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "kfa-get-detection") {
      sendResponse({ ...detected });
    }
    return true;
  });

  /* ------------------------------------------------------------------ *
   * 10. Boot                                                             *
   * ------------------------------------------------------------------ */

  function init() {
    injectLightDomFontFaces();
    applySettingsToPage();
    startInputWatcher();
    startDetection();
    startChatRootWatch();
  }

  loadSettings(init);
})();
