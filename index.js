'use strict'
require('colors')
const exec = require('child_process').exec
const charm = require('charm')(process.stdout)
const Progress = require('multi-progress')
const argv = require('argh').argv
const path = require('path')
const fs = require('fs')

const progress = new Progress(process.stderr)
const dirname = process.cwd()
const PKG = 'package.json'
const packages = {}
const links = {}
const bars = {}
var strlength = 0
var lines = 0

let cores = require('os').cpus().length
const queue = []

process.on('uncaughtException', exit)
process.on('SIGINT', exit)
process.on('exit', cleanup)

charm.cursor(false)

fs.readdir(dirname, (err, files) => {
  if (err) { throw err }
  console.log('TURBOLINK!'.bold.underline)
  let count = 0
  for (let i = files.length - 1; i >= 0; i--) {
    const file = path.join(dirname, files[i])
    const pkgpath = path.join(file, PKG)
    count++
    fs.stat(pkgpath, (err) => {
      if (err) {
        return count--
      }
      if (argv.pull) {
        exec('git pull', { cwd: file }).on('close', readpackage)
      } else {
        readpackage()
      }
      function readpackage () {
        fs.readFile(pkgpath, 'utf-8', (err, data) => {
          if (err) { throw err }
          const pkg = JSON.parse(data)
          const l = pkg.name.length
          packages[file] = pkg
          links[pkg.name] = file
          strlength = l > strlength ? l : strlength
          --count || proceed()
        })
      }
    })
  }
})

function proceed () {
  var count = lines = Object.keys(packages).length
  for (var file in packages) {
    const pkg = packages[file]
    linkorinstall(
      file,
      pkg.dependencies,
      pkg.devDependencies,
      countdown
    )
  }
  function countdown () {
    --count || test()
  }
}

function linkorinstall (file, deps, devdeps, done) {
  if (deps || devdeps) {
    const tolink = []
    const toinstall = []
    collect(deps, tolink, toinstall)
    collect(devdeps, tolink, toinstall)

    let name = packages[file].name
    let l = name.length
    while (l++ < strlength) {
      name = name + ' '
    }

    bars[file] = progress.newBar(`${name.bold} [:bar] ` + ':percent'.bold + ' :msg', {
      complete: '='.bold,
      incomplete: ' ',
      width: 20,
      total: toinstall.length + tolink.length + 1
    })

    bars[file].tick(0, { msg: '' })

    fork((next) => {
      install(file, toinstall, () => {
        link(file, tolink, () => {
          bars[file].tick({ msg: '' })
          next()
          done()
        })
      })
    })
  } else {
    done()
  }
}

function collect (deps, tolink, toinstall) {
  if (deps) {
    for (let dep in deps) {
      if (links[dep]) {
        tolink.push(dep)
      } else {
        toinstall.push(dep)
      }
    }
  }
}

function install (file, toinstall, done) {
  const dep = toinstall.shift()
  if (dep) {
    bars[file].tick({ msg: dep })
    fs.stat(path.join(file, 'node_modules', dep), (err) => {
      if (err) {
        exec('npm i ' + dep + ' --production --link', { cwd: file })
        .on('close', () => install(file, toinstall, done))
      } else {
        install(file, toinstall, done)
      }
    })
  } else {
    done()
  }
}

function link (file, tolink, done) {
  const dep = tolink.shift()
  if (dep) {
    bars[file].tick({ msg: dep })
    const from = links[dep]
    const to = path.join(file, 'node_modules', dep)
    bars[file].tick({ msg: dep })
    exec(`rm -rf ${to} && ln -s ` + from + ' ' + to)
    .on('close', () => link(file, tolink, done))
  } else {
    done()
  }
}

function test () {
  for (var file in packages) {
    const bar = bars[file]
    fork((next) => {
      let dots = '.'
      const int = global.setInterval(() => {
        bar.tick({ msg: 'testing' + dots })
        dots = dots[2] ? '' : dots + '.'
      }, 500)
      exec('npm test', { cwd: file })
      .on('close', (code) => {
        global.clearInterval(int)
        bar.tick({ msg: code ? '⨯'.red.bold : '✓'.green.bold })
        next()
      })
    })
  }
}

function fork (fn) {
  if (fn) { queue.push(fn) }
  if (cores) {
    const queued = queue.shift()
    if (queued) {
      cores--
      queued(() => {
        cores++
        fork()
      })
      fork()
    }
  }
}

function cleanup () {
  charm.move(lines)
  charm.cursor(true)
}

function exit (options, err) {
  process.exit()
}
