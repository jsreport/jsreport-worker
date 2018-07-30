const path = require('path')
const fs = require('fs')
const Promise = require('bluebird')
const ScriptManager = require('script-manager')
const ListenerCollection = require('listener-collection')
const extend = require('node.extend')
const omit = require('lodash.omit')
const Reporter = require('./reporter')
const WorkerRequest = require('./request')

let spec = {}

const rootDir = path.join(__dirname, '../')

extend(true, spec, readReporterSpec(path.join(rootDir, 'main.reporter.json')))

fs.readdirSync(path.join(rootDir)).forEach((f) => {
  if (f.endsWith('.reporter.json') && f !== 'main.reporter.json') {
    const customSpecFile = path.join(rootDir, f)
    console.log(`applying custom reporter spec found in ${customSpecFile}`)
    extend(true, spec, readReporterSpec(customSpecFile))
  }
})

module.exports = (options = {}) => {
  // hmmmm
  if (options.chrome && options.chrome.launchOptions && options.chrome.launchOptions.args) {
    options.chrome.launchOptions.args = options.chrome.launchOptions.args.split(',')
  }

  if (options.workerSpec) {
    console.log(`applying worker spec from options ${JSON.stringify(options.workerSpec)}`)
    extend(true, spec, options.workerSpec || {})
  }

  const reporter = new Reporter(options)
  const initListeners = new ListenerCollection()
  const recipeExtensionLoadListeners = new ListenerCollection()
  const executeListeners = new ListenerCollection()
  const closeListeners = new ListenerCollection()

  const currentRequests = {}
  const cache = {}
  const scriptManager = ScriptManager(options.scriptManager)
  const proxyHandle = require('jsreport-scripts/lib/jsreportProxy').handle

  Promise.promisifyAll(scriptManager)

  async function executeRecipe ({ req, res }) {
    const recipePackage = spec.recipes[req.template.recipe]

    if (!recipePackage) {
      throw new Error(`recipe "${req.template.recipe}" not found or available`)
    }

    if (!cache[recipePackage]) {
      let recipeExt

      try {
        recipeExt = require(recipePackage)
      } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
          throw new Error(`recipe ${req.template.recipe} (${recipePackage}) is not installed`)
        }

        throw e
      }

      const recipeConfig = recipeExt()

      await recipeConfig.main(reporter, {
        name: recipeConfig.name,
        options: options.extensions[req.template.recipe] || {}
      })

      cache[recipePackage] = reporter.extensionsManager.recipes.find((r) => r.name === req.template.recipe).execute

      await recipeExtensionLoadListeners.fire(reporter, recipePackage, req.template.recipe)
    }

    if (res.content) {
      res.content = Buffer.from(res.content, 'base64')
    }

    await cache[recipePackage](req, res)

    res.content = !Buffer.isBuffer(res.content) ? Buffer.from(res.content) : res.content
    res.content = res.content.toString('base64')

    return { req, res }
  }

  async function executeScriptManager (uuid, { inputs, options }) {
    function localPath (p) {
      if (!p) {
        return
      }

      if (p.lastIndexOf('node_modules') !== -1) {
        const remoteModules = p.substring(0, p.lastIndexOf('node_modules'))
        const localModules = path.join(path.dirname(require.resolve('jsreport-core')), '../../')

        p = p.replace(remoteModules, localModules)
      }

      return p.replace(/\\/g, '/')
    }

    inputs.templatingEngines = Object.assign({}, reporter.options.templatingEngines, inputs.templatingEngines)

    // for xlsx path
    if (inputs.data && inputs.data.$xlsxModuleDirname != null) {
      inputs.data.$xlsxModuleDirname = localPath(inputs.data.$xlsxModuleDirname)
    }

    if (inputs.templatingEngines.modules) {
      inputs.templatingEngines.modules.forEach((i) => {
        if (typeof i === 'object' && i.path != null) {
          i.path = localPath(i.path)
        }
      })
    }

    if (inputs.templatingEngines.nativeModules) {
      inputs.templatingEngines.nativeModules.forEach((i) => {
        if (typeof i === 'object' && i.module != null) {
          i.module = localPath(i.module)
        }
      })
    }

    inputs.safeSandboxPath = localPath(inputs.safeSandboxPath)
    inputs.engine = localPath(inputs.engine)
    options.execModulePath = localPath(options.execModulePath)
    options.appDirectory = inputs.appDirectory = path.join(__dirname, '../')
    options.rootDirectory = inputs.rootDirectory = inputs.appDirectory
    options.parentModuleDirectory = inputs.parentModuleDirectory = inputs.appDirectory

    options.callback = (spec, cb) => {
      spec.data.req.uuid = uuid
      return proxyHandle(reporter, inputs.request, spec, cb)
    }

    return scriptManager.executeAsync(inputs, options).catch((e) => {
      const ee = new Error(e.message)
      ee.stack = e.stack
      throw ee
    })
  }

  reporter.render = async (req, parentReq) => {
    let currentReq
    let uuid

    if (parentReq) {
      // request from header/footer, child templates
      uuid = parentReq.context.uuid
      currentReq = currentRequests[uuid]
    } else {
      const uuid = req.uuid
      delete req.uuid
      // request from jsreport-proxy
      currentReq = currentRequests[uuid]
    }

    const renderRes = await currentReq.callback({
      action: 'render',
      data: {
        req
      }
    })

    if (parentReq) {
      extend(true, parentReq, omit(renderRes.req, ['data']))
      parentReq.data = renderRes.req.data
    } else {
      extend(true, req, omit(renderRes.req, ['data']))
      req.data = renderRes.req.data
    }

    // this makes .req information not available in render from scripts
    delete renderRes.req

    if (renderRes.content) {
      renderRes.content = Buffer.from(renderRes.content, 'base64')
    }

    return renderRes
  }

  return ({
    async init () {
      await scriptManager.ensureStartedAsync()
      await initListeners.fire()
    },
    addInitListener (...args) { initListeners.add(...args) },
    addRecipeExtensionLoadListener (...args) { recipeExtensionLoadListeners.add(...args) },
    addExecuteListener (name, fn) {
      executeListeners.add(name, async (opts) => {
        // logic to stop execution after first result
        const { running, lastResult, ...restOpts } = opts

        if (running && lastResult != null) {
          return
        }

        const result = await fn(restOpts)

        opts.running = true
        opts.lastResult = result

        return result
      })
    },
    addCloseListeners (...args) { closeListeners.add(...args) },
    removeInitListener (...args) { initListeners.remove(...args) },
    removeRecipeExtensionLoadListener (...args) { recipeExtensionLoadListeners.remove(...args) },
    removeExecuteListener (...args) { executeListeners.remove(...args) },
    removeCloseListener (...args) { closeListeners.remove(...args) },
    reporter: reporter,
    async execute (currentHttpReq, { type, uuid, data }) {
      if (!type && !currentRequests[uuid]) {
        const msg = 'Could not process callback response of request, no previous request found'
        console.error(`${msg}. uuid: ${uuid}`)
        throw new Error(msg)
      }

      if (currentRequests[uuid]) {
        return currentRequests[uuid].processCallbackResponse(currentHttpReq, { data })
      }

      const workerRequest = WorkerRequest(uuid, { data }, {
        callbackTimeout: options.workerCallbackTimeout != null ? (
          options.workerCallbackTimeout
        ) : 40000,
        onSuccess: ({ uuid }) => {
          delete currentRequests[uuid]
        },
        onError: ({ uuid, error, httpReq }) => {
          if (httpReq.socket.destroyed) {
            // don't clear request if the last http request
            // was destroyed already, this can only happen if there is an error
            // that is throw in worker (like a timeout) while waiting
            // for some callback response call.
            //
            // this handling gives the chance for
            // "processCallbackResponse" to run and resolve with a timeout error after
            // being detected idle for a while
            console.error(`An error was throw when there is no active http connection to respond. uuid: ${
              uuid
            } error: ${error.message}, stack: ${
              error.stack
            }, attrs: ${JSON.stringify(error)}`)
            return
          }

          delete currentRequests[uuid]
        }
      })

      currentRequests[uuid] = workerRequest

      let customResults = await executeListeners.fire({
        running: false,
        lastResult: null,
        type,
        uuid,
        data,
        executeRecipe,
        workerRequest
      })

      customResults = customResults.find(i => i != null)

      if (customResults != null) {
        return customResults
      }

      if (type === 'recipe') {
        return workerRequest.process(currentHttpReq, () => executeRecipe(data))
      }

      if (type === 'scriptManager') {
        return workerRequest.process(currentHttpReq, () => executeScriptManager(uuid, data))
      }

      throw new Error(`Unsuported worker action type ${type}`)
    },
    async close () {
      scriptManager.kill()
      await closeListeners.fire()
    }
  })
}

function readReporterSpec (specPath) {
  const specContent = fs.readFileSync(specPath).toString()

  try {
    return JSON.parse(specContent)
  } catch (e) {
    throw new Error(`Error while trying to parse reporter spec in ${
      specPath
    }, check that the content is valid json. ${e.message}`)
  }
}
