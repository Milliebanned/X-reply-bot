// Catch-all for every /api/* path.
//
// Vercel resolves URLs beginning with /api against this directory before
// it consults the rewrites in vercel.json. Without this file, a request
// such as POST /api/suggest-reply matches no function and returns
// Vercel's own 404 page rather than reaching Express.
module.exports = require('../backend/server.js');
