/* ==========================================================================
   KickFa — background.js (MV3 service worker)
   --------------------------------------------------------------------------
   CHANGE IN v1.3.0: STORAGE_KEY / DEFAULT_SETTINGS were previously
   duplicated here. Now imported from shared.js via importScripts() (fine
   for a classic, non-module service worker) so background.js,
   content.js, and popup.js can never drift out of sync on defaults.

   Seeds default settings the first time the extension is installed, so
   content.js and popup.js always find something in chrome.storage.sync.
   ========================================================================== */

importScripts("shared.js");

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;

  chrome.storage.sync.get(KFA_STORAGE_KEY, (result) => {
    if (!result[KFA_STORAGE_KEY]) {
      chrome.storage.sync.set({ [KFA_STORAGE_KEY]: KFA_DEFAULT_SETTINGS });
    }
  });
});
