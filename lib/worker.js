const path = require('path')
const fs = require('fs')
const Koa = require('koa')
const Processor = require('./processor')
const nconf = require('nconf')

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
  const processor = Processor(options)

  const app = new Koa()

  app.on('error', err => {
    console.error('server error', err)
  })
  app.use(require('koa-bodyparser')())
  app.use(async ctx => {
    if (ctx.method === 'GET') {
      ctx.body = 'ok'
      return
    }

    try {
      ctx.body = await processor.execute(ctx.request.body)
    } catch (e) {
      console.error(e)
      ctx.status = 400
      ctx.body = { message: e.message, stack: e.stack }
    }
  })

  bootstrapExports.forEach((bootstrapFn) => {
    bootstrapFn({ processor, app, options })
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
