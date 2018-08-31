const path = require('path')
const fs = require('fs')
const events = require('events')
const mkdirp = require('mkdirp')
const createOrExtendError = require('jsreport-core/lib/util/createError')

module.exports = class Reporter extends events.EventEmitter {
  constructor (options = {}) {
    super()
    this.extensionsManager = {
      recipes: [],
      engines: []
    }

    this.version = '2.0.0'
    this.options = Object.assign(options, {
      rootDirectory: path.join(__dirname, '../'),
      templatingEngines: {
        nativeModules: [],
        modules: [],
        allowedModules: []
      },
      tempDirectory: options.workerTempDirectory,
      tempAutoCleanupDirectory: path.join(options.workerTempAutoCleanupDirectory)
    })

    if (!fs.existsSync(this.options.tempDirectory)) {
      mkdirp.sync(this.options.tempDirectory)
    }

    if (!fs.existsSync(this.options.tempAutoCleanupDirectory)) {
      mkdirp.sync(this.options.tempAutoCleanupDirectory)
    }

    this.options.extensions = this.options.extensions || {}

    this.documentStore = {
      registerComplexType: () => {},
      registerEntityType: () => {},
      registerEntitySet: () => {},
      model: {
        entityTypes: {
          TemplateType: {}
        }
      }
    }

    this.initializeListeners = this.beforeRenderListeners = this.afterRenderListeners = { insert: () => {}, add: () => {} }

    const log = (level) => (msg, meta) => {
      if (level === 'debug' || level === 'info') {
        console.log(msg)
      } else if (level === 'warn') {
        console.warn(msg)
      } else if (level === 'error') {
        console.error(msg)
      }

      if (meta != null && meta.context) {
        meta.context.logs = meta.context.logs || []

        meta.context.logs.push({
          level: level,
          message: msg,
          timestamp: meta.timestamp || new Date().getTime()
        })
      }
    }

    this.logger = {
      debug: log('debug'),
      info: log('info'),
      error: log('error'),
      warn: log('warn')
    }
  }

  createListenerCollection () {
    return this.initializeListeners
  }

  createError (message, options = {}) {
    return createOrExtendError(message, options)
  }
}
