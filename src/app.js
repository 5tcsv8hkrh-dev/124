'use strict';

require('express');

module.exports = require('./bootstrap').createApplication().app;
