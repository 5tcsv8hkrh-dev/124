'use strict';
/**
 * errorHandler.js - turns every error into a safe JSON response.
 * The browser only ever sees a short code and a friendly message: never a stack trace,
 * file path, API key, or raw error text from a library.
 */

const { AppError } = require('./errors');

function notFoundApi(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'This API address does not exist.' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    const error = { code: err.code, message: err.message };
    if (err.details) error.details = err.details;
    return res.status(err.status).json({ error });
  }
  // Errors raised by express.json() for a bad request body.
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'The request is too large.' } });
  }
  // Anything else is a bug on our side: log a short note, tell the client nothing specific.
  console.error(`[server] unexpected error: ${err && err.name ? err.name : 'unknown'}`);
  return res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server. Please try again.' } });
}

module.exports = { errorHandler, notFoundApi };
