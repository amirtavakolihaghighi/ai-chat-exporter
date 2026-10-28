/**
 * Options: the defaults every copy starts with, and what a person changed.
 *
 * The defaults are in config/default-settings.json — one file, kept with the
 * project, with a section for what both apps share and one for each app. The
 * built-in copy below is the fallback when that file is missing or broken, and
 * the reference for what each option is: a value in the file of the wrong kind
 * is ignored rather than trusted.
 *
 * A person's own settings file holds only what they changed. The defaults can
 * then change — in a new version, or in the defaults file — without a saved
 * copy of the old ones standing in the way.
 *
 * Loaded like src/shared/parts.js: a CommonJS module, or a plain <script>,
 * where it defines `AceSettings`.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.AceSettings = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BUILT_IN = {
    shared: {
      filenameTemplate: '{date} - {provider} - {title}',
      theme: 'light',
      fontSize: 15,
      includeMeta: true,
      includeThinking: true,
      includeSystem: true,
      frontmatter: true,
      embedImages: true,
      assetMode: 'inline',
      pageBreakPerTurn: false,
      expandLinks: false,
      jpegQuality: 92,
      settleMs: 450,
      maxScrollSteps: 400,
      maxReadSeconds: 90,
      redactions: [],
      // Batch export skips sites with no rules unless told otherwise: a guess
      // nobody looked at should not turn into a file nobody checks.
      batchGuessUnknown: false,
    },
    desktop: {
      // Empty means the exports folder inside the data folder.
      outDir: '',
      captureMode: 'clean',
      pageSize: 'A4',
      marginInches: 0.5,
      landscape: false,
      scale: 1,
      pageNumbers: true,
      printBackground: true,
      openAfterExport: true,
      lastFormats: ['pdf'],
    },
    extension: {
      lastFormats: ['md'],
      minCodeLines: 1,
      assistantOnlyCode: false,
      screenshotDelayMs: 550,
    },
  };

  const copy = (value) => JSON.parse(JSON.stringify(value));
  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  /** Whether `value` is the same kind of thing as the default it would replace. */
  function sameKind(reference, value) {
    if (Array.isArray(reference)) return Array.isArray(value);
    return value !== null && typeof value === typeof reference;
  }

  /**
   * The defaults for one app, 'desktop' or 'extension': the built-in ones,
   * with whatever the defaults file says laid over them.
   */
  function defaultsFor(which, fromFile) {
    const out = copy({ ...BUILT_IN.shared, ...BUILT_IN[which] });
    const file = isObject(fromFile) ? fromFile : {};
    for (const section of [file.shared, file[which]]) {
      if (!isObject(section)) continue;
      for (const [key, value] of Object.entries(section)) {
        if (key in out && sameKind(out[key], value)) out[key] = copy(value);
      }
    }
    return out;
  }

  /** Saved settings over the defaults, leaving out anything that is not an option of the right kind. */
  function withDefaults(saved, defaults) {
    const out = copy(defaults);
    if (isObject(saved)) {
      for (const [key, value] of Object.entries(saved)) {
        if (key in defaults && sameKind(defaults[key], value)) out[key] = copy(value);
      }
    }
    return out;
  }

  /** Only the options that differ from the defaults: what goes in a person's settings file. */
  function changedFrom(settings, defaults) {
    const out = {};
    if (!isObject(settings)) return out;
    for (const key of Object.keys(defaults)) {
      const value = settings[key];
      if (value === undefined || !sameKind(defaults[key], value)) continue;
      if (JSON.stringify(value) !== JSON.stringify(defaults[key])) out[key] = copy(value);
    }
    return out;
  }

  return { BUILT_IN, defaultsFor, withDefaults, changedFrom };
});
