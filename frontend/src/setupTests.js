// Environnement de test Jest (react-scripts / jsdom) : react-router 7 attend TextEncoder/TextDecoder au chargement,
// Radix (Dialog, Checkbox…) attend ResizeObserver. Les fichiers de test peuvent aussi importer components/shared/jestEnv.js.
const util = require('util');

if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = util.TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = util.TextDecoder;
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
