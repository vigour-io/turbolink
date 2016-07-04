'use strict'

require('colors')

const readSettings = require('./settings')
const git = require('./git')
const npm = require('./npm')
const test = require('./test')
const clean = require('./clean')

module.exports = function turboLink (args) {
  return readSettings(argv)
    .then(checkDirectory)
    .then(git.clone)
    .then(git.pull)
    .then(npm.install)
    .then(npm.link)
    .then(test)
    .then(clean)
}
