'use strict';
// Single serverless entry point. vercel.json rewrites every /api/* path here.
module.exports = require('../lib/router').handle;
