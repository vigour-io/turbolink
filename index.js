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
var useGlobal = argv.global // global can be a path as well!
var turbo = argv.turbo
var settings
var npmglobals

const rcpath = path.join(dirname, '.turbolink')

fs.stat(rcpath, (err) => {
  if (!err) {
    settings = require(rcpath)
    if (settings.global) {
      if (settings.pull) {
        argv.pull = true
      }
      useGlobal = true
      if (settings.turbo) {
        turbo = settings.turbo
      }
    }
    if (!settings.local) {
      settings.local = {
        'pre-commit': true
      }
    }
  }
  if (turbo) {
    if (turbo === true) {
      const root = exec('npm root -g', { maxBuffer })
      root.stdout.on('data', (data) => {
        npmglobals = data.toString().replace(/\n$/, '')
        console.log('turbo-check:', npmglobals)
      })
      root.on('close', (data) => {
        checkdir()
      })
    } else {
      npmglobals = turbo
      checkdir()
    }
  } else {
    checkdir()
  }
})

process.on('uncaughtException', exit)
process.on('SIGINT', exit)
process.on('exit', cleanup)

function checkdir () {
  fs.stat(path.join(dirname, PKG), (err) => {
    console.log('TURBOLINK'.underline.bold)
    if (!err) { dirname = path.dirname(dirname) }
    if (settings) {
      console.log('from .turbolink settings file'.green)
      if (settings.repos) {
        clonerepo(0, () => {
          console.log('cloned repos...')
          init()
        })
      }
    } else {
      init()
    }
  })
}

function repoDone (i, done) {
  if (i < settings.repos.length - 1) {
    clonerepo(++i, done)
  } else {
    done()
  }
}

function clonerepo (i, done) {
  fs.stat(path.join(dirname, settings.repos[i]), (err) => {
    if (err) {
      var branch
      var dir
      if (settings.repos[i].indexOf('#') > -1) {
        const split = settings.repos[i].split('#')
        branch = split[1]
        settings.repos[i] = split[0]
      }
      dir = settings.repos[i]
      console.log('git@' + settings.gitURL + '/' + settings.repos[i])
      exec('git clone git@' + settings.gitURL + '/' + settings.repos[i] + '', { maxBuffer })
      .on('close', () => {
        if (branch) {
          console.log('got branch checkout', branch, path.join(process.cwd(), dir))
          const fetch = exec(`git fetch origin`, { maxBuffer, cwd: path.join(process.cwd(), dir) })
          fetch.stderr.on('data', err => {
            console.log(err.toString().red)
          })

          fetch.stdout.on('data', data => {
            console.log(data)
          })

          fetch.on('close', () => {
            const br = exec(`git checkout ${branch}`, { maxBuffer, cwd: path.join(process.cwd(), dir) })
            br.stderr.on('data', err => {
              console.log(err.toString().red)
            })
            br.on('close', () => {
              repoDone(i, done)
            })
          })
        } else {
          repoDone(i, done)
        }
      })
    } else {
      if (i < settings.repos.length - 1) {
        clonerepo(++i, done)
      } else {
        done()
      }
    }
  })
}

function init () {
  charm.cursor(false)
  charm.position((x, y) => (lines = y))
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
            const pull = exec('git pull', { cwd: file, maxBuffer })
            pull.stderr.on('data', (data) => {
              console.log('git:'.red, file.red, data.toString().red)
            })
            pull.stdout.on('data', (data) => {
              data = data.toString()
              if (/Already up-to-date/.test(data)) {

              } else {
                console.log('git:', file, data)
              }
            })
            pull.on('close', () => fs.readFile(pkgpath, 'utf-8', read))
          } else {
            fs.readFile(pkgpath, 'utf-8', read)
          }
        }

        function read (er, data) {
          const pkg = JSON.parse(data.toString())
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
}

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
    bars[file].tick({ msg: `install: ${dep}` })
    fs.stat(path.join(file, 'node_modules', dep), (err) => {
      if (err) {
        if (turbo && !(settings.local && settings.local[dep])) {
          fs.stat(npmglobals + '/' + dep, (err, data) => {
            if (err) {
              npmInstall(file, toinstall, done, dep)
            } else {
              process.nextTick(function () {
                install(file, toinstall, done)
              })
            }
          })
        } else {
          npmInstall(file, toinstall, done, dep)
        }
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

function npmInstall (file, toinstall, done, dep) {
  exec(
    `npm i ${dep} --production ${useGlobal && !(settings.local && settings.local[dep]) ? '-g' : '--link'}`,
    { cwd: file, maxBuffer }
  )
  .on('close', () => install(file, toinstall, done))
}

function link (file, tolink, done) {
  const dep = tolink.shift()
  if (dep) {
    bars[file].tick({ msg: `link: ${dep}` })
    const from = links[dep]
    const nodeModules = path.join(file, 'node_modules')
    const dir = dep[0] === '@' ? path.join(nodeModules, dep.split('/')[0]) : nodeModules
    const to = path.join(nodeModules, dep)
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

function exit (reason) {
  console.log('exit!'.red, reason.toString().red)
  if (turbo) {
    turbomultilink()
  } else {
    process.exit()
  }
}

function turbomultilink () {
  var gmodules = fs.readdirSync(npmglobals)
  gmodules = gmodules.filter((val) => !/^\./.test(val))
  const l = Object.keys(links)
  const r = []
  for (var i in l) {
    r.push(links[l[i]])
  }
  console.log('\n\n\n turbo multi link all modules: ' + gmodules.length * l.length)
  dolinks(r, 0, () => process.exit(), gmodules)
}

function dolinks (arr, i, done, gmodules) {
  if (i === arr.length) {
    done()
  } else {
    console.log('   ' + (i + 1) * gmodules.length + '/' + gmodules.length * arr.length)
    fs.stat(arr[i] + '/node_modules', (err) => {
      if (err) {
        fs.mkdirSync(arr[i] + '/node_modules')
      }
      let nm = fs.readdirSync((arr[i] + '/node_modules'))
      let rdy = gmodules.length
      for (let j in gmodules) {
        if (nm.indexOf(gmodules[j]) === -1) {
          var cmd = 'ln -s ' + npmglobals + '/' + gmodules[j] + ' ' + arr[i] + '/node_modules/' + gmodules[j]
          exec(cmd, { maxBuffer }).on('close', function () {
            rdy--
            if (rdy === 0) {
              dolinks(arr, ++i, done, gmodules)
            }
          })
        } else {
          rdy--
          if (rdy === 0) {
            dolinks(arr, ++i, done, gmodules)
          }
        }
      }
    })
  }
}
