const Koa = require('koa')
const Processor = require('./processor')
const nconf = require('nconf')

module.exports = (options = {}) => {
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

  return ({
    async init () {
      await processor.init()
      this.server = app.listen(options.httpPort)
    },
    close () {
      this.server.close()
      processor.close()
    }
  })
}
