const Reporter = require('./reporter')
const pckg = require('../package.json')
const Promise = require('bluebird')
const ScriptManager = require('script-manager')
const path = require('path')
const WorkerRequest = require('./request')

module.exports = (options = {}) => {
  const reporter = new Reporter()
  const currentRequests = {}
  const cache = {}
  const scriptManager = ScriptManager(options.scriptManager)
  Promise.promisifyAll(scriptManager)

  async function executeRecipe ({ req, res }) {
    const recipePackage = pckg.jsreport.recipes[req.template.recipe]
    if (!cache[recipePackage]) {
      require(recipePackage)().main(reporter, { options: {} })
      cache[recipePackage] = reporter.extensionsManager.recipes.find((r) => r.name === req.template.recipe).execute
    }

    await cache[recipePackage](req, res)
    res.content = res.content.toString('base64')
    return { req, res }
  }

  async function executeScriptManager ({ inputs, options }) {
    await scriptManager.ensureStartedAsync() 

    function localPath (p) {
      if (!p) {
        return
      }

      const remoteModules = p.substring(0, p.lastIndexOf('node_modules'))
      const localModules = path.join(path.dirname(require.resolve('jsreport-core')), '../../')

      return p.replace(remoteModules, localModules)
    }

    inputs.safeSandboxPath = localPath(inputs.safeSandboxPath)
    inputs.engine = localPath(inputs.engine)
    options.execModulePath = path.join(options.execModulePath)
    options.callback = () => {}

    return scriptManager.executeAsync(inputs, options).catch((e) => {
      const ee = new Error(e.message)
      ee.stack = e.stack
      throw ee
    })
  }

  reporter.render = (req, parentReq) => {
    const currentReq = currentRequests[parentReq.context.uuid]
    return currentReq.callback({
      action: 'render',
      data: {
        req
      }
    })
  }

  return ({
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
