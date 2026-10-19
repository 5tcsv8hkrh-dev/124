'use strict';
/**
 * wiring.test.js - checks how routes.js and createApp.js connect things, using tiny stand-ins for
 * express, helmet and express-rate-limit. It always runs (no packages needed) and catches
 * mistakes such as a wrong URL, wrong method, missing limiter or missing security settings.
 * The real packages are exercised by tests/express.test.js when they are installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function withFakes(run) {
  const log = { routes: [], uses: [], limiters: [], helmetOptions: null, staticDir: null, jsonOptions: null, disabled: [] };
  const fakes = {
    express: Object.assign(
      () => ({
        disable: (name) => log.disabled.push(name),
        use: (...args) => log.uses.push(args),
      }),
      {
        Router: () => ({
          use: (...a) => log.routes.push(['USE', ...a]),
          get: (p, ...h) => log.routes.push(['GET', p, ...h]),
          post: (p, ...h) => log.routes.push(['POST', p, ...h]),
        }),
        json: (options) => { log.jsonOptions = options; return function jsonParser() {}; },
        static: (dir) => { log.staticDir = dir; return function staticFiles() {}; },
      }
    ),
    helmet: (options) => { log.helmetOptions = options; return function helmetMiddleware() {}; },
    'express-rate-limit': (options) => {
      const limiter = function limiterMiddleware() {};
      limiter.options = options;
      log.limiters.push(options);
      return limiter;
    },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request in fakes) return fakes[request];
    return original.call(this, request, ...rest);
  };
  for (const key of Object.keys(require.cache)) {
    if (/src[\\/](createApp|routes[\\/]index)\.js$/.test(key)) delete require.cache[key];
  }
  try {
    return run(log);
  } finally {
    Module._load = original;
    for (const key of Object.keys(require.cache)) {
      if (/src[\\/](createApp|routes[\\/]index)\.js$/.test(key)) delete require.cache[key];
    }
  }
}

const deps = { content: require('../src/services/scoringService').loadContent(), explainer: {}, gemini: null, config: { recommendationsPerMinute: 7 } };

test('router: exposes the four documented endpoints with the right methods', () => {
  withFakes((log) => {
    const { createApiRouter } = require('../src/routes');
    createApiRouter(deps);
    const table = log.routes.filter((r) => r[0] !== 'USE').map((r) => `${r[0]} ${r[1]}`).sort();
    assert.deepEqual(table, ['GET /careers', 'GET /health', 'GET /questions', 'POST /recommendations']);
  });
});

test('router: rate limiting - general limiter on every API call, stricter configurable one on recommendations', () => {
  withFakes((log) => {
    const { createApiRouter } = require('../src/routes');
    createApiRouter(deps);
    assert.equal(log.limiters.length, 2);
    const [general, recommendations] = log.limiters;
    assert.equal(recommendations.limit, 7, 'uses RATE_LIMIT_PER_MINUTE');
    assert.equal(recommendations.windowMs, 60 * 1000);
    assert.ok(general.limit > recommendations.limit);
    assert.equal(typeof recommendations.handler, 'function');

    const uses = log.routes.filter((r) => r[0] === 'USE');
    assert.equal(uses[0][1].options, general, 'general limiter is registered first');
    const post = log.routes.find((r) => r[0] === 'POST');
    assert.equal(post[2].options, recommendations, 'recommendations limiter runs before the handler');
    assert.equal(typeof post[3], 'function');
    assert.equal(uses[uses.length - 1][1].name, 'notFoundApi', 'unknown /api addresses return JSON 404');
  });
});

test('rate-limit handler answers with the JSON error shape', () => {
  withFakes((log) => {
    const { createApiRouter } = require('../src/routes');
    createApiRouter(deps);
    const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    log.limiters[1].handler({}, res);
    assert.equal(res.code, 429);
    assert.equal(res.body.error.code, 'rate_limited');
  });
});

test('app: helmet CSP is strict, upgrade-insecure-requests is off, body size is limited, errors handled last', () => {
  withFakes((log) => {
    const { createApp } = require('../src/createApp');
    createApp(deps);
    const csp = log.helmetOptions.contentSecurityPolicy.directives;
    assert.deepEqual(csp['script-src'], ["'self'"]);
    assert.deepEqual(csp['style-src'], ["'self'"]);
    assert.equal(csp['upgrade-insecure-requests'], null);
    assert.ok(!JSON.stringify(csp).includes('unsafe-inline') && !JSON.stringify(csp).includes('unsafe-eval'));
    assert.equal(log.jsonOptions.limit, '20kb');
    assert.ok(log.disabled.includes('x-powered-by'));
    assert.ok(log.staticDir.endsWith('public'));

    const order = log.uses.map((u) => (typeof u[0] === 'string' ? u[0] : u[0].name));
    assert.deepEqual(order, ['helmetMiddleware', 'jsonParser', '/api', 'staticFiles', 'errorHandler']);
  });
});
