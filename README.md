# turbolink
Links all your projects together, where npm link fails.

<!-- VDOC.badges standard; npm -->
<!-- DON'T EDIT THIS SECTION (including comments), INSTEAD RE-RUN `vdoc` TO UPDATE -->
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg)](http://standardjs.com/)
[![npm version](https://badge.fury.io/js/turbolink.svg)](https://badge.fury.io/js/turbolink)
<!-- VDOC END -->

## Getting started

### Installing

Installing via NPM

```shell
npm i turbolink -g
```

Installing with linking

```shell
git clone git@github.com:vigour-io/turbolink.git && cd turbolink && npm link
```


### Usage

To run you can use:

```shell
tl
```

or

```shell
turbolink
```

Here are few more options you can use:

- `--reset` remove all `node_modules` before starting
- `--update` update all existing node_modules
- `--pull` pull all projects before starting
