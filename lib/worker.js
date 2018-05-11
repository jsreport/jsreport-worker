const Koa = require('koa')
const Processor = require('./processor')

module.exports = (options = {}) => {
  const processor = Processor(options)

  const app = new Koa()

  app.on('error', err => {
    console.error('server error', err)
  })
  app.use(require('koa-bodyparser')())
  app.use(async ctx => {
    try {
      ctx.body = await processor.execute(ctx.request.body)
    } catch (e) {
      console.error(e)
      ctx.status = 400
      ctx.body = { message: e.message, stack: e.stack }
    }
  })

  const server = app.listen(options.httpPort)

  return ({
    close () {
      server.close()
      processor.close()
    },
    server
  })
}
