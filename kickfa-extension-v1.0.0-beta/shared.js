/* ==========================================================================
   KickFa — shared.js  (NEW in v1.3.0)
   --------------------------------------------------------------------------
   Single source of truth for the storage key, default settings, and the
   font-preset catalog (which Persian font pairs with which English font,
   and where each weight's .woff2 file lives under /fonts/).

   Previously STORAGE_KEY and DEFAULT_SETTINGS were copy-pasted separately
   into background.js, content.js, and popup.js — three places that had to
   be kept in sync by hand. Now all three load this file first and read
   from KFA_STORAGE_KEY / KFA_DEFAULT_SETTINGS instead, so there is exactly
   one place to update.

   Loaded as a plain classic script (no ES module syntax) in all three
   contexts:
     - content_scripts (manifest.json)  — listed before content.js
     - background.js                    — via importScripts("shared.js")
     - popup.html                       — <script src="shared.js"> before popup.js

   ASSUMPTION ON FONT FILES: the task brief says to assume the new .woff2
   files are already placed in /fonts/. The filenames below are a
   reasonable guess (standard release naming for each family). If your
   actual files are named differently, this is the ONLY place you need to
   edit — every other file reads filenames through KFA_FONT_FILES.
   ========================================================================== */

"use strict";

/* ------------------------------------------------------------------ *
 * Storage                                                              *
 * ------------------------------------------------------------------ */

const KFA_STORAGE_KEY = "kfaSettings";

/* ------------------------------------------------------------------ *
 * Font file catalog                                                    *
 * ------------------------------------------------------------------ */

// Persian glyphs + common Arabic-script punctuation/presentation forms.
// Used to build the unicode-range-restricted "-Auto" face for each
// Persian family (Smart mode).
const KFA_PERSIAN_UNICODE_RANGE =
  "U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF";

// Every family needs Regular(400) / Medium(500) / Bold-or-SemiBold(700)
// files. Adjust paths here if your actual filenames differ.
const KFA_FONT_FILES = {
  vazirmatn: {
    400: "fonts/Vazirmatn-Regular.woff2",
    500: "fonts/Vazirmatn-Medium.woff2",
    700: "fonts/Vazirmatn-Bold.woff2",
  },
  shabnam: {
    400: "fonts/Shabnam.woff2", // ships without a "-Regular" suffix
    500: "fonts/Shabnam-Medium.woff2",
    700: "fonts/Shabnam-Bold.woff2",
  },
  inter: {
    400: "fonts/Inter-Regular.woff2",
    500: "fonts/Inter-Medium.woff2",
    700: "fonts/Inter-Bold.woff2",
  },
  ibmplexsans: {
    400: "fonts/IBMPlexSans-Regular.woff2",
    500: "fonts/IBMPlexSans-Medium.woff2",
    700: "fonts/IBMPlexSans-SemiBold.woff2",
  },
};

// Display name used both as the CSS font-family name (for English
// families) and as the prefix for Persian families' "-Auto"/"-Full"
// synthetic family names (e.g. "Vazirmatn-Auto").
const KFA_FONT_DISPLAY_NAMES = {
  vazirmatn: "Vazirmatn",
  shabnam: "Shabnam",
  inter: "Inter",
  ibmplexsans: "IBM Plex Sans",
};

// Persian families get TWO @font-face declarations per weight (an
// "-Auto" unicode-range-restricted face for Smart mode, and a "-Full"
// unrestricted face for Force All mode). English families get ONE.
const KFA_PERSIAN_FAMILIES = ["vazirmatn", "shabnam"];
const KFA_ENGLISH_FAMILIES = ["inter", "ibmplexsans"];

const KFA_FONT_WEIGHTS = [400, 500, 700];

/* ------------------------------------------------------------------ *
 * Presets                                                              *
 * ------------------------------------------------------------------ */

const KFA_FONT_PRESETS = {
  "vazirmatn-inter": {
    id: "vazirmatn-inter",
    label: "Vazirmatn + Inter (Default)",
    persian: "vazirmatn",
    english: "inter",
  },
  "shabnam-inter": {
    id: "shabnam-inter",
    label: "Shabnam + Inter",
    persian: "shabnam",
    english: "inter",
  },
  "vazirmatn-ibmplexsans": {
    id: "vazirmatn-ibmplexsans",
    label: "Vazirmatn + IBM Plex Sans",
    persian: "vazirmatn",
    english: "ibmplexsans",
  },
  "shabnam-ibmplexsans": {
    id: "shabnam-ibmplexsans",
    label: "Shabnam + IBM Plex Sans",
    persian: "shabnam",
    english: "ibmplexsans",
  },
};

const KFA_DEFAULT_FONT_PRESET = "vazirmatn-inter";

/* ------------------------------------------------------------------ *
 * Default settings                                                     *
 * ------------------------------------------------------------------ */

const KFA_DEFAULT_SETTINGS = {
  enabled: true,
  autoDetect: true,
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.5,
  fontPreset: KFA_DEFAULT_FONT_PRESET,
};

/* ------------------------------------------------------------------ *
 * Helpers                                                              *
 * ------------------------------------------------------------------ */

// "Vazirmatn" -> "Vazirmatn-Auto" (unicode-range restricted face name).
function kfaPersianAutoFamily(familyKey) {
  return `${KFA_FONT_DISPLAY_NAMES[familyKey] || familyKey}-Auto`;
}

// "Vazirmatn" -> "Vazirmatn-Full" (unrestricted face name).
function kfaPersianFullFamily(familyKey) {
  return `${KFA_FONT_DISPLAY_NAMES[familyKey] || familyKey}-Full`;
}

// Builds the full @font-face CSS text for all 4 shipped families (both
// Persian "-Auto"/"-Full" variants and the 2 English families), using
// chrome.runtime.getURL() so every src is an ABSOLUTE
// chrome-extension://<id>/fonts/... URL rather than a relative path.
//
// WHY: a relative url("fonts/....woff2") inside fonts.css — even though
// fonts.css is only ever loaded via the extension's own content_scripts
// "css" array or the popup's own <link> tag — was observed resolving
// against the PAGE's origin (https://kick.com/fonts/...) instead of the
// extension's origin, causing 404s. chrome.runtime.getURL() sidesteps
// the ambiguity entirely by producing a fully-qualified URL up front, and
// works identically in every extension context (content script, shadow
// root, popup). This is now the ONLY way font files are referenced
// anywhere in the extension — fonts.css itself no longer contains any
// @font-face rule.
function kfaBuildFontFaceCSS() {
  let css = "";

  KFA_PERSIAN_FAMILIES.forEach((familyKey) => {
    const files = KFA_FONT_FILES[familyKey];
    const autoName = kfaPersianAutoFamily(familyKey);
    const fullName = kfaPersianFullFamily(familyKey);
    KFA_FONT_WEIGHTS.forEach((weight) => {
      const url = chrome.runtime.getURL(files[weight]);
      css += `@font-face{font-family:"${autoName}";src:url("${url}") format("woff2");font-weight:${weight};font-display:swap;unicode-range:${KFA_PERSIAN_UNICODE_RANGE};}\n`;
      css += `@font-face{font-family:"${fullName}";src:url("${url}") format("woff2");font-weight:${weight};font-display:swap;}\n`;
    });
  });

  KFA_ENGLISH_FAMILIES.forEach((familyKey) => {
    const files = KFA_FONT_FILES[familyKey];
    const name = KFA_FONT_DISPLAY_NAMES[familyKey];
    KFA_FONT_WEIGHTS.forEach((weight) => {
      const url = chrome.runtime.getURL(files[weight]);
      css += `@font-face{font-family:"${name}";src:url("${url}") format("woff2");font-weight:${weight};font-display:swap;}\n`;
    });
  });

  return css;
}

// Resolves a stored fontPreset id to its full preset record, falling
// back to the default if the id is unknown (e.g. a preset removed in a
// future version, or corrupted storage).
function kfaResolvePreset(presetId) {
  return KFA_FONT_PRESETS[presetId] || KFA_FONT_PRESETS[KFA_DEFAULT_FONT_PRESET];
}

// Given a preset id, returns the 3 CSS custom-property VALUES (already
// quoted, ready to assign via style.setProperty) that content.js/popup.js
// write onto :root: the Persian Smart-mode face, the Persian Force-All
// face, and the plain English face name.
function kfaGetFontFamilyVars(presetId) {
  const preset = kfaResolvePreset(presetId);
  return {
    persianAuto: `"${kfaPersianAutoFamily(preset.persian)}"`,
    persianFull: `"${kfaPersianFullFamily(preset.persian)}"`,
    english: `"${KFA_FONT_DISPLAY_NAMES[preset.english] || preset.english}"`,
  };
}
