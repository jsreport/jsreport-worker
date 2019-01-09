const util = require('util')
const path = require('path')
const fs = require('fs')
const uuidPkg = require('uuid')
const Promise = require('bluebird')
const ScriptManager = require('script-manager')
const ListenerCollection = require('listener-collection')
const extend = require('node.extend')
const omit = require('lodash.omit')
const Reporter = require('./reporter')
const WorkerRequest = require('./request')
const readFileAsync = util.promisify(fs.readFile)
const writeFileAsync = util.promisify(fs.writeFile)

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

function extendRenderRequest (originalReq, copyReq) {
  extend(true, originalReq, omit(copyReq, ['data']))
  originalReq.data = copyReq.data
}

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
  const pdfUtilsRenderCallback = require('jsreport-pdf-utils/lib/scriptCallbackRender')
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

    if (req.template.recipe === 'xlsx') {
      // here we check if there are some files contents that need to be restored from
      // base64 to file paths that exists, in order for recipe to do its work normally
      await restoreXlsxFiles(reporter.options.tempAutoCleanupDirectory, res)
    }

    await cache[recipePackage](req, res)

    // delete any stream in result because streams can not be serialized
    delete res.stream

    return { req, res }
  }

  async function executeScriptManager (uuid, { inputs, options, req }) {
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

    const isXlsxTemplateEngineWork = (
      inputs.engine != null &&
      inputs.template != null &&
      inputs.template.recipe === 'xlsx'
    )

    // for xlsx path
    if (
      isXlsxTemplateEngineWork &&
      inputs.data &&
      inputs.data.$xlsxModuleDirname != null
    ) {
      inputs.data.$xlsxModuleDirname = localPath(inputs.data.$xlsxModuleDirname)
    }

    // for xlsx temp directory
    if (
      isXlsxTemplateEngineWork &&
      inputs.data &&
      inputs.data.$tempAutoCleanupDirectory != null
    ) {
      inputs.data.$tempAutoCleanupDirectory = reporter.options.tempAutoCleanupDirectory
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

    if (inputs.templatingEngines.tempAutoCleanupDirectory) {
      inputs.templatingEngines.tempAutoCleanupDirectory = reporter.options.tempAutoCleanupDirectory
    }

    if (inputs.templatingEngines.tempDirectory) {
      inputs.templatingEngines.tempDirectory = reporter.options.tempDirectory
    }

    if (inputs.templatingEngines.tempCoreDirectory) {
      inputs.templatingEngines.tempCoreDirectory = reporter.options.tempDirectory
    }

    inputs.safeSandboxPath = localPath(inputs.safeSandboxPath)
    inputs.engine = localPath(inputs.engine)
    options.execModulePath = localPath(options.execModulePath)
    options.appDirectory = inputs.appDirectory = path.join(__dirname, '../')
    options.rootDirectory = inputs.rootDirectory = inputs.appDirectory
    options.parentModuleDirectory = inputs.parentModuleDirectory = inputs.appDirectory

    if (inputs.pdfContent != null && inputs.operations != null) {
      options.callback = (operationParams, cb) => {
        req.uuid = uuid
        return pdfUtilsRenderCallback(reporter, req, operationParams, cb)
      }
    } else if (inputs.script != null && inputs.method != null) {
      options.callback = (spec, cb) => {
        if (spec.action === 'render') {
          req.uuid = uuid
        } else if (spec.action.startsWith('documentStore')) {
          req.uuid = uuid
        }

        return proxyHandle(reporter, req, spec, cb)
      }
    } else {
      options.callback = () => {}
    }

    const result = await scriptManager.executeAsync(inputs, options).catch((e) => {
      const ee = new Error(e.message)
      ee.stack = e.stack
      throw ee
    })

    if (isXlsxTemplateEngineWork && result.content != null) {
      // when template engine that uses xlsx helpers has been processed,
      // the output content sometimes contains some temporary files path
      // that won't exists in another process/container after sending the response,
      // here we serialize the content of these files and send it as base64 instead of paths,
      // the base64 contents will be restored as existing file paths when getting recipe work
      // and before recipe execution
      await serializeXlsxFiles(result)
    }

    return result
  }

  reporter.documentStore.collection = (name) => {
    async function makeQuery (action, originalReq, q) {
      const uuid = originalReq.uuid
      let currentReq

      delete originalReq.uuid

      currentReq = currentRequests[uuid]

      const result = await currentReq.callback({
        action,
        data: {
          collection: name,
          query: q,
          originalReq
        }
      })

      extendRenderRequest(originalReq, result.req)

      if (result.error) {
        const queryError = new Error(result.error.message)
        queryError.stack = result.error.stack
        throw queryError
      }

      return result.queryResult
    }

    return {
      find: (q, originalReq) => makeQuery('documentStore.collection.find', originalReq, q),
      findOne: (q, originalReq) => makeQuery('documentStore.collection.findOne', originalReq, q)
    }
  }

  reporter.render = async (req, parentReq) => {
    let currentReq
    let uuid

    if (parentReq) {
      if (parentReq.uuid) {
        // request from jsreport-proxy's render and pdf-utils
        uuid = parentReq.uuid
        delete parentReq.uuid
      } else if (parentReq.context.uuid) {
        // request from header/footer, child templates
        uuid = parentReq.context.uuid
      }

      currentReq = currentRequests[uuid]
    } else {
      uuid = req.context.uuid
      currentReq = currentRequests[uuid]
    }

    const renderRes = await currentReq.callback({
      action: 'render',
      data: {
        req,
        parentReq
      }
    })

    if (parentReq) {
      extendRenderRequest(parentReq, renderRes.req)
    } else {
      extendRenderRequest(req, renderRes.req)
    }

    if (renderRes.error) {
      const renderError = new Error(renderRes.error.message)
      renderError.stack = renderRes.error.stack
      throw renderError
    }

    // this makes .req information not available in render from scripts
    delete renderRes.req

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
        httpReq: currentHttpReq,
        executeRecipe,
        executeScriptManager,
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

async function serializeXlsxFiles (scriptResponse) {
  let content

  try {
    content = JSON.parse(scriptResponse.content)
  } catch (e) {
    // fallback to original syntax
    return
  }

  if (Array.isArray(content.$files)) {
    await Promise.all(content.$files.map(async (f, i) => {
      const fcontent = await readFileAsync(f)
      content.$files[i] = fcontent.toString('base64')
    }))

    scriptResponse.content = JSON.stringify(content)
  }
}

async function restoreXlsxFiles (tempDirectory, res) {
  let content

  try {
    content = JSON.parse(res.content.toString())
  } catch (e) {
    return
  }

  await Promise.all(content.$files.map(async (f, i) => {
    const filePath = path.join(tempDirectory, uuidPkg.v4() + '.xml')

    await writeFileAsync(filePath, Buffer.from(content.$files[i], 'base64'))

    content.$files[i] = filePath
  }))

  res.content = Buffer.from(JSON.stringify(content))
}
