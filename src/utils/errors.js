'use strict';
/**
 * errors.js - small error classes that carry an HTTP status and a SAFE public message.
 * Only `code` and `message` of an AppError are ever sent to the browser.
 */

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details; // optional: list of validation problems (safe to show)
  }
}

module.exports = { AppError };
