'use strict';
/**
 * createApp.js - builds the Express application (no network port is opened here).
 * server.js starts it; tests and scripts can build it with fake dependencies.
 */

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { createApiRouter } = require('./routes');
const { errorHandler } = require('./utils/errorHandler');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Everything (scripts, styles, fonts, images) comes from this server only.
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          // Helmet's default would force https, which breaks http://localhost in some browsers.
          'upgrade-insecure-requests': null,
        },
      },
    })
  );

  app.use(express.json({ limit: '20kb' }));
  app.use('/api', createApiRouter(deps));
  app.use(express.static(PUBLIC_DIR));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
