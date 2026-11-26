// Build entry point. The card's source lives in src/; this file stays at the
// root so `esbuild index.js` (package.json scripts, the release workflow and
// local deploy scripts) keeps working unchanged.
import './src/index.js';
