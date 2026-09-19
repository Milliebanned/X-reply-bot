// Serves GET /api/health.
// Vercel maps each file in this directory to the matching URL path, so the
// filename is what routes the request. The Express app registers
// '/api/health' and handles it from there.
module.exports = require('../backend/server.js');
