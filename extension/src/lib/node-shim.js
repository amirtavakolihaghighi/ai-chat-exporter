/**
 * Shims injected into every bundle by esbuild.
 *
 * The export core (converters, renderers, DOCX and merge builders) is shared
 * verbatim with the desktop app, where it runs under Node. Only a couple of
 * dependencies still probe for Node globals; this defines the minimum needed
 * for them to run in a browser.
 *
 * Deliberately NO Buffer shim. JSZip — which both `docx` and the ZIP export go
 * through — decides between its Node and browser code paths with
 * `typeof Buffer !== "undefined"`. Defining a Buffer, however faithful, flips
 * that detection and sends it down the Node path, where `Uint8Array.slice()`
 * returns a plain array rather than a Buffer and filenames end up decoded as
 * comma-separated character codes. Leaving Buffer undefined is what makes the
 * library behave correctly here, and the shared core no longer needs it: it
 * deals in Uint8Array throughout (see src/shared/bytes.js).
 */

// `docx` and a few transitive dependencies branch on `process.env.NODE_ENV`.
export const process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  // No `versions.node` — libraries use it to detect Node, and we are not it.
  versions: {},
  nextTick: (fn, ...args) => Promise.resolve().then(() => fn(...args)),
  cwd: () => '/',
};

// Some CommonJS bundles test for `global`.
export const global = globalThis;
