const path = require('path')
const fs = require('fs')
const Promise = require('bluebird')
const ScriptManager = require('script-manager')
const extend = require('node.extend')
const Reporter = require('./reporter')
const WorkerRequest = require('./request')

let spec = {}

const rootDir = path.join(__dirname, '../')

extend(true, spec, readReporterSpec(path.join(rootDir, 'main.reporter.json')))

fs.readdirSync(path.join(rootDir)).forEach((f) => {
  if (f.endsWith('.reporter.json') && f !== 'main.reporter.json') {
    console.log(f)
    extend(true, spec, readReporterSpec(f))
  }
})

module.exports = (options = {}) => {
  // hmmmm
  if (options.chrome && options.chrome.launchOptions && options.chrome.launchOptions.args) {
    options.chrome.launchOptions.args = options.chrome.launchOptions.args.split(',')
  }

  const reporter = new Reporter(options)
  const currentRequests = {}
  const cache = {}
  const scriptManager = ScriptManager(options.scriptManager)
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

      await recipeExt().main(reporter, { options: options.extensions[req.template.recipe] || {} })

      cache[recipePackage] = reporter.extensionsManager.recipes.find((r) => r.name === req.template.recipe).execute
    }

    await cache[recipePackage](req, res)
    res.content = res.content.toString('base64')
    return { req, res }
  }

  async function executeScriptManager ({ inputs, options }) {
    function localPath (p) {
      if (!p) {
        return
      }

      const remoteModules = p.substring(0, p.lastIndexOf('node_modules'))
      const localModules = path.join(path.dirname(require.resolve('jsreport-core')), '../../')

      return p.replace(remoteModules, localModules).replace(/\\/g, '/')
    }

    inputs.templatingEngines = reporter.options.templatingEngines
    inputs.safeSandboxPath = localPath(inputs.safeSandboxPath)
    inputs.engine = localPath(inputs.engine)
    options.execModulePath = localPath(options.execModulePath)
    options.appDirectory = inputs.appDirectory = path.join(__dirname, '../')
    options.rootDirectory = inputs.rootDirectory = inputs.appDirectory
    options.parentModuleDirectory = inputs.parentModuleDirectory = inputs.appDirectory

    options.callback = () => {}

    return scriptManager.executeAsync(inputs, options).catch((e) => {
      const ee = new Error(e.message)
      ee.stack = e.stack
      throw ee
    })
  }

  reporter.render = async (req, parentReq) => {
    const currentReq = currentRequests[parentReq.context.uuid]
    const renderRes = await currentReq.callback({
      action: 'render',
      data: {
        req
      }
    })
    Object.assign(parentReq, renderRes.req)
    return renderRes
  }

  return ({
    async init () {
      await scriptManager.ensureStartedAsync()
    },
    async execute ({ type, uuid, data }) {
      if (currentRequests[uuid]) {
        return currentRequests[uuid].processCallbackResponse({ data })
      }

      const workerRequest = WorkerRequest({ data })
      currentRequests[uuid] = workerRequest

      if (type === 'recipe') {
        return workerRequest.process(executeRecipe(data))
      }

      if (type === 'scriptManager') {
        return executeScriptManager(data)
      }

      throw new Error(`Unsuported worker action type ${type}`)
    },
    close () {
      scriptManager.kill()
    }
  })
}

function readReporterSpec (specPath) {
  const specContent = fs.readFileSync(specPath)

  try {
    return JSON.parse(specContent)
  } catch (e) {
    throw new Error(`Error while trying to parse reporter spec in ${
      specPath
    }, check that the content is valid json. ${e.message}`)
  }
}
