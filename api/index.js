// Vercel serverless entrypoint for /api itself.
// Paths below /api are handled by api/[...path].js; everything outside
// /api arrives here through the catch-all rewrite in vercel.json.
module.exports = require('../backend/server.js');
