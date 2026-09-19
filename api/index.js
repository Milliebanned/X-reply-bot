// Vercel serverless entrypoint.
// Vercel auto-detects files under /api as functions; this re-exports
// the same Express app used for local development in backend/server.js.
module.exports = require('../backend/server.js');
