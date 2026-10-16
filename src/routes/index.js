'use strict';
/** routes/index.js - attaches the handlers to URLs. */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createHandlers } = require('./recommendations');
const { notFoundApi } = require('../utils/errorHandler');

function limiterResponse(req, res) {
  res.status(429).json({
    error: { code: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' },
  });
}

function createApiRouter(deps) {
  const { config } = deps;
  const handlers = createHandlers(deps);
  const router = express.Router();

  // A general limit for every API call, and a stricter one for the (AI-backed) recommendations call.
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: limiterResponse,
  });
  const recommendationsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.recommendationsPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: limiterResponse,
  });

  router.use(generalLimiter);
  router.get('/health', handlers.health);
  router.get('/questions', handlers.questions);
  router.get('/careers', handlers.careers);
  router.post('/recommendations', recommendationsLimiter, handlers.recommendations);
  router.use(notFoundApi);
  return router;
}

module.exports = { createApiRouter };
