'use strict'
const Observable = require('vigour-observable')
const child_process = require('child_process')
const download = require('download-tarball')
const semver = require('semver')
const fs = require('fs')

Observable.prototype.inject(require('vigour-is'))
const cores = new Observable(Math.max(1, require('os').cpus().length - 2))
const count = new Observable(0)
const downloading = new Observable(0)
const linking = new Observable(0)

fs.readFile('package.json', (err, data) => {
  error(err)

  const pkg = JSON.parse(data)
  const tree = merge(pkg.dependencies, pkg.devDependecies)

  count.on((data, stamp) => {
    const val = count.compute()
    if (!val) {
      for (var name in tree) {
        for (var version in tree[name].selected) {
          // @todo check if there is an optimization to share versions here
          dload(name, version, tree[name].tarball, tree[name].repository)
        }
      }
    }
  })

  downloading.on((data, stamp) => {
    const val = downloading.compute()
    console.log('downloading:', val)
    // if (!val) {
    //   for (var name in tree) {
    //     for (var version in tree[name].selected) {

    //     }
    //   }
    // }
  })

  linking.on((data, stamp) => {
    const val = linking.compute()
    console.log('linking:', val)
  })

  for (let name in tree) {
    let range = tree[name]
    prepare(name)
    getdeps(name, range)
  }

  function getdeps (name, range) {
    if (!tree[name]) {
      prepare(name)
    }
    if (!tree[name].versions) {
      getversions(name, range)
    } else if (!tree[name].required[range]) {
      selectversions(name, range)
    }
  }

  function prepare (name) {
    tree[name] = {
      required: {},
      selected: {}
    }
  }

  function getversions(name, range) {
    tree[name].versions = true
    exec(`npm view ${name} versions dist.tarball repository --json`, (err, data) => {
      error(err)
      const obj = JSON.parse(data)
      tree[name].tarball = obj['dist.tarball']
      tree[name].versions = obj.versions
      tree[name].repository = obj.repository
      selectversions(name, range)
    })
  }

  function selectversions (name, range) {
    const versions = tree[name].versions
    let version
    for (var i = versions.length - 1; i >= 0; i--) {
      if (semver.satisfies(versions[i], range)) {
        version = versions[i]
        break
      }
    }
    if (version) {
      tree[name].required[range] = version
      if (!tree[name].selected[version]) {
        tree[name].selected[version] = {}
        exec(`npm view ${name}@${version} dependencies --json`, (err, data) => {
          error(err)
          if (data && data.trim() !== 'undefined') {
            const obj = tree[name].selected[version] = JSON.parse(data)
            for (var i in obj) {
              getdeps(i, obj[i])
            }
          }
        })
      }
    } else {
      tree[name].required[range] = false
    }
  }
})

function merge (a, b) {
  if (b) { for (var i in b) { a[i] = b[i] } }
  return a
}

function exec (cmd, cb) {
  count.set(count.compute() + 1)
  cores.is(val => val > 0, (data, stamp) => {
    cores.set(cores.compute() - 1, stamp)
    child_process.exec(cmd, (err, data) => {
      cb(err, data)
      cores.set(cores.compute() + 1)
      count.set(count.compute() - 1)
    })
  })
}

function dload (name, version, tarball, repo) {
  const module = `${name}@${version}`
  const dest = `shared_modules/${module}`
  downloading.set(downloading.compute() + 1)
  fs.stat(dest, (err) => {
    if (!err) {
      downloading.set(downloading.compute() - 1)
      return
    }
    cores.is(val => val > 0, (data, stamp) => {
      cores.set(cores.compute() - 1, stamp)
      download({
        url: tarball,
        dir: `shared_modules/.tmp/${module}`
      }).then(() => {
        fs.rename(
          `shared_modules/.tmp/${module}/package`,
          dest,
          () => fs.mkdir(`${dest}/node_modules`, () => done)
        )
      }).catch((err) => {
        console.log('error downloading from npm')
        if (repo && repo.type === 'git') {
          console.log('lets try git')
          let url = repo.url
          url = url.replace('+https://github.com/', '@github.com:')
          exec(`git clone --branch v${version} ${url} ${dest}`, done)
        } else {
          done()
        }
      })
      function done () {
        cores.set(cores.compute() + 1)
        downloading.set(downloading.compute() - 1)
      }
    })
  })
}

function error (err) {
  if (err) { console.error(err) }
}


