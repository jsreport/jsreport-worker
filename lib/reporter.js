const path = require('path')
const events = require('events')
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
      tempAutoCleanupDirectory: process.env.temp || require('os').tmpdir()
    })
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
      const message = msg + (meta != null && typeof meta === 'object' ? ` ${JSON.stringify(meta)}` : '')

      if (level === 'debug' || level === 'info') {
        console.log(message)
      } else if (level === 'warn') {
        console.warn(message)
      } else if (level === 'error') {
        console.error(message)
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
