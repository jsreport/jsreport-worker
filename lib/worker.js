const path = require('path')
const fs = require('fs')
const Koa = require('koa')
const Processor = require('./processor')
const nconf = require('nconf')
const serializator = require('serializator')

let bootstrapFiles = []

const rootDir = path.join(__dirname, '../bootstrap')

fs.readdirSync(rootDir).forEach((f) => {
  if (f.endsWith('.reporter.js')) {
    const bootstrapFile = path.join(rootDir, f)
    console.log(`found bootstrap file ${bootstrapFile}`)
    bootstrapFiles.push(bootstrapFile)
  }
})

module.exports = (options = {}) => {
  const bootstrapExports = []

  if (bootstrapFiles.length > 0) {
    for (const file of bootstrapFiles) {
      try {
        bootstrapExports.push(require(file))
      } catch (e) {
        e.message = `Error while trying to require bootstrap file in ${file}. ${e.message}`
        throw e
      }
    }
  }

  options = nconf.overrides(options).argv().env({ separator: ':' }).env({ separator: '_' }).get()
  options.httpPort = options.httpPort || 2000

  console.log(`Worker temp directory is: ${options.workerTempDirectory}`)
  console.log(`Worker temp auto cleanup directory is: ${options.workerTempAutoCleanupDirectory}`)

  if (options.workerDebuggingSession) {
    console.log('Debugging session is enabled')
  }

  options.workerInputRequestLimit = options.workerInputRequestLimit || '20mb'

  const processor = Processor(options)

  const app = new Koa()

  app.on('error', err => {
    console.error('server error', err)
  })

  console.log(`worker input request limits is configured to: ${options.workerInputRequestLimit}`)

  app.use(require('koa-bodyparser')({
    formLimit: options.workerInputRequestLimit,
    jsonLimit: options.workerInputRequestLimit,
    textLimit: options.workerInputRequestLimit
  }))

  app.use(async ctx => {
    if (ctx.method === 'GET') {
      ctx.body = 'ok'
      return
    }

    if (options.workerDebuggingSession) {
      // this line is useful for debugging, because it makes the request never
      // be aborted, which give us time to debug easily
      ctx.req.setTimeout(0)
    }

    try {
      if (!ctx.request.body.payload) {
        throw new Error('request to worker must contain ".payload" property in body')
      }

      const inputRequest = serializator.parse(ctx.request.rawBody).payload
      const processorResult = await processor.execute(ctx.request, inputRequest)

      ctx.body = serializator.serialize({
        payload: processorResult
      })

      ctx.set('Content-Type', 'application/json')
    } catch (e) {
      console.error(e)
      ctx.status = 400
      ctx.body = { message: e.message, stack: e.stack }
    }
  })

  bootstrapExports.forEach((bootstrapFn) => {
    bootstrapFn({
      processor,
      reporter: processor.reporter,
      app,
      options
    })
  })

  return ({
    async init () {
      await processor.init()
      this.server = app.listen(options.httpPort)
    },
    async close () {
      this.server.close()
      await processor.close()
    }
  })
}
