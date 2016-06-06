#!/usr/bin/env node
'use strict'

const Promise = require('bluebird')
Promise.promisifyAll(require('fs'))
const glob = require('glob')
const path = require('path')
const fs = require('fs')
const _map = require('lodash/map')
const _forIn = require('lodash/forIn')
const _template = require('lodash/template')
const _merge = require('lodash/merge')

const program = require('commander')
program
  .command('build <config> <source> <target>')
  .option('-i, --include <directory>', 'load additional includes from this directory')
  .description('build the views in source and write to target')
  .action(
    (config, source, target, options) => {
      let cfg = require(path.join(process.cwd(), config))
      let environment = cfg.get('environment')
      let templatedata = {
        version: cfg.get('version'),
        deployVersion: +new Date(),
        appName: cfg.get('appName'),
        name: cfg.get('app'),
        description: cfg.get('description'),
        apiIndex: cfg.get('api_host') + '/api',
        mimeType: cfg.get('mime_type'),
        environment: environment
      }

      let includes = {}
      let directives = {}

      console.log()
      console.log('Building template files …')
      console.log(' data:')
      _map(templatedata, (value, key) => {
        console.log('  ' + key + ': ' + value)
      })

      /**
       * This function can be called from a template to add additional static data
       *
       * @param {String} includeName
       * @param {Object} scope to be merged onto the template data
       */
      let include = (includeName, scope) => {
        scope = scope || {}
        let included = buildTemplate(includes[includeName], {
          data: _merge({}, scope, templatedata),
          includes: includes,
          include
        })
        return included
      }

      // Build includes
      let globAsync = Promise.promisify(glob)
      let scanForIncludes = [
        globAsync(source + '/includes/*.html')
      ]
      if (options.include) {
        scanForIncludes.push(globAsync(options.include + '/*.html'))
      }

      return Promise.join(Promise.all(scanForIncludes), globAsync(source + '/js/directives/*.html'))
        .spread((includeTemplates, directiveTemplates) => {
          return Promise.join(
            Promise.map(includeTemplates, (includesFound) => {
              return Promise.map(includesFound, (file) => {
                let fileEnv = file.match(/@([a-z]+)\.[^\.]+$/)
                if (fileEnv) {
                  fileEnv = fileEnv[1]
                }
                return fs.readFileAsync(file, 'utf8').then((data) => {
                  let trg = file.replace(source + '/includes/', '')
                  if (options.include) {
                    trg = trg.replace(options.include, '')
                  }
                  trg = trg.replace(/\.html$/, '')
                  trg = trg.replace(/\//, '.')
                  trg = trg.replace(/@([a-z]+)$/, '')
                  if (fileEnv && fileEnv !== environment) {
                    data = false
                  } else {
                    includes[trg] = data
                  }
                })
              })
                .then(() => {
                  _forIn(includes, (template, trg) => {
                    includes[trg] = buildTemplate(template, {data: templatedata, includes: includes, include})
                  })
                })
            }),
            Promise.map(directiveTemplates, (file) => {
              return fs.readFileAsync(file, 'utf8').then((data) => {
                let trg = file.replace(source + '/js/directives/', '')
                trg = trg.replace(/\.html$/, '')
                trg = trg.replace(/\//, '.')
                data = _template(data)({data: templatedata})
                directives[trg] = data
              })
            })
          )
        })
        .then(() => {
          return globAsync(source + '/*.html')
            .map((src) => {
              return fs.readFileAsync(src, 'utf8').then((data) => {
                data = _template(data)({data: templatedata, includes: includes, directives: directives})
                let trg = target + '/' + src.replace(source + '/', '')
                console.log(src + ' -> ' + trg)
                return fs.writeFileAsync(trg, data)
              })
            })
        })
        .then(() => {
          process.exit(0)
        })
        .catch((err) => {
          console.error(err)
          process.exit(1)
        })
    }
  )

/**
 * Recursively build the template, this allows for includes to contain includes …
 *
 * @param template
 * @param data
 * @param step
 */
let buildTemplate = (template, data, step) => {
  step = step || 1
  if (step >= 10) {
    console.error('Reached maximum nesting level', step)
    return template
  }
  let previousResult = template
  let result = _template(template)(data)
  if (result === previousResult) {
    return result
  }
  return buildTemplate(result, data, ++step)
}

program.parse(process.argv)
