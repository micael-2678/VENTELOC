// Environnement de test (Jest 27 / jsdom de react-scripts) : react-router 7 attend TextEncoder/TextDecoder au
// chargement. Importé en premier par les tests de ce dossier (équivalent de src/setupTests.js, limité à ce chantier).
const util = require('util');

if (typeof globalThis.TextEncoder === 'undefined') globalThis.TextEncoder = util.TextEncoder;
if (typeof globalThis.TextDecoder === 'undefined') globalThis.TextDecoder = util.TextDecoder;
