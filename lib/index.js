'use strict'

require('colors')

const readSettings = require('./read-settings')
const preRunCheck = require('./pre-run-check')
const git = require('./git')
const npm = require('./npm')
const test = require('./test')
const clean = require('./clean')

module.exports = function turboLink (args) {
  return readSettings(args)
    .then(preRunCheck)
    .then(git.clone)
    .then(git.pull)
    .then(npm.install)
    .then(npm.link)
    .then(test)
    .then(clean)
}
