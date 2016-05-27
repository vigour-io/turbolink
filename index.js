'use strict'
require('colors')
const exec = require('child_process').exec
const charm = require('charm')(process)
const Progress = require('multi-progress')
const argv = require('argh').argv
const path = require('path')
const fs = require('fs')

const progress = new Progress(process.stderr)
const PKG = 'package.json'
const packages = {}
const links = {}
const queue = []
const bars = {}
const max = argv.max
const maxBuffer = 500 * 1024

var cores = typeof max === 'number' ? max : max ? 1 : require('os').cpus().length
var dirname = process.cwd()
var pkgnumber = 0
var strlength = 0
var lines = 0

process.on('uncaughtException', exit)
process.on('SIGINT', exit)
process.on('exit', cleanup)

fs.stat(path.join(dirname, PKG), (err) => {
  console.log('TURBOLINK'.underline.bold)
  charm.cursor(false)
  charm.position((x, y) => lines = y)

  if (!err) { dirname = path.dirname(dirname) }

  fs.readdir(dirname, (err, files) => {
    if (err) { throw err }
    let count = 0
    for (let i = files.length - 1; i >= 0; i--) {
      const file = path.join(dirname, files[i])
      const pkgpath = path.join(file, PKG)
      count++
      fs.stat(pkgpath, (err) => {

        if (err) {
          return count--
        }

        if (argv.reset) {
          exec('rm -rf node_modules', { cwd: file, maxBuffer })
          .on('close', readpackage)
        } else {
          readpackage()
        }

        function readpackage () {
          if (argv.pull) {
            exec('git pull', { cwd: file, maxBuffer })
            .on('close', () => fs.readFile(pkgpath, 'utf-8', read))
          } else {
            fs.readFile(pkgpath, 'utf-8', read)
          }
        }

        function read (err, data) {
          if (err) { throw err }
          const pkg = JSON.parse(data)
          const l = pkg.name.length
          packages[file] = pkg
          links[pkg.name] = file
          strlength = l > strlength ? l : strlength
          pkgnumber += 1
          --count || proceed()
        }

      })
    }
  })
})

function proceed () {
  var count = pkgnumber
  lines += count
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

    run((next) => {
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
        exec('npm i ' + dep + ' --production --link', { cwd: file, maxBuffer })
        .on('close', () => install(file, toinstall, done))
      } else if (argv.update) {
        exec('npm update ' + dep, { cwd: file, maxBuffer })
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
    const node_modules = path.join(file, 'node_modules')
    const dir = dep[0] === '@' ? path.join(node_modules, dep.split('/')[0]) : node_modules
    const to = path.join(node_modules, dep)
    bars[file].tick({ msg: dep })
    fs.stat(dir, (err) => {
      if (err) {
        exec(`mkdir -p ${dir} && ln -s ` + from + ' ' + to, { maxBuffer })
        .on('close', () => link(file, tolink, done))
      } else {
        exec(`rm -rf ${to} && ln -s ` + from + ' ' + to, { maxBuffer })
        .on('close', () => link(file, tolink, done))
      }
    })
  } else {
    done()
  }
}

function test () {
  for (var file in packages) {
    const bar = bars[file]
    run((next) => {
      let dots = '.'
      const int = global.setInterval(() => {
        bar.tick({ msg: 'testing' + dots })
        dots = dots[2] ? '' : dots + '.'
      }, 500)
      exec('npm test', { cwd: file, maxBuffer })
      .on('close', (code) => {
        global.clearInterval(int)
        bar.tick({ msg: code ? '⨯'.red.bold : '✓'.green.bold })
        next()
        if (!--pkgnumber) { exit() }
      })
    })
  }
}

function run (fn) {
  if (fn) { queue.push(fn) }
  if (cores) {
    const queued = queue.shift()
    if (queued) {
      cores--
      queued(() => {
        cores++
        run()
      })
      run()
    }
  }
}

function cleanup () {
  charm.position(0, lines)
  charm.cursor(true)
  charm.destroy()
}

function exit () {
  process.exit()
}
