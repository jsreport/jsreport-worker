const supertest = require('supertest')
const Worker = require('../')
require('should')

function encodePayload (payload) {
  return {
    payload: payload
  }
}

function decodeResponse (responseBody) {
  if (!responseBody.payload) {
    // body is coming from error response
    return responseBody
  }

  return responseBody.payload
}

describe('worker', () => {
  let request
  let worker

  beforeEach(async () => {
    worker = Worker({
      httpPort: 3000,
      scriptManager: { strategy: 'in-process' },
      extensions: {
        'chrome-pdf': {
          launchOptions: {
            args: ['--no-sandbox']
          }
        }
      },
      workerSpec: {
        recipes: {
          'phantom-pdf': 'jsreport-phantom-pdf',
          'wkhtmltopdf': 'jsreport-wkhtmltopdf'
        }
      }
    })
    await worker.init()
    request = supertest(worker.server)
  })

  afterEach(async () => {
    await worker.close()
  })

  it('should be able to run recipe chrome-pdf', () => {
    return request
      .post('/')
      .send(encodePayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: { template: { recipe: 'chrome-pdf' }, context: { uuid: '1' } },
          res: { content: 'Hello', meta: {} }
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })
  })

  it('should be able to run engine handlebars', () => {
    return request
      .post('/')
      .send(encodePayload({
        type: 'scriptManager',
        data: {
          inputs: {
            safeSandboxPath: require.resolve('jsreport-core/lib/render/safeSandbox.js'),
            engine: require.resolve('jsreport-handlebars/lib/handlebarsEngine.js'),
            template: { content: 'foo {{m}}' },
            data: { m: 'hello' }
          },
          options: {
            execModulePath: require.resolve('jsreport-core/lib/render/engineScript.js')
          }
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.logs.should.be.of.Array()
        body.content.should.be.eql('foo hello')
      })
  })

  it('should be able to run recipe chrome-pdf and propagate logs', () => {
    return request
      .post('/')
      .send(encodePayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: { template: { recipe: 'chrome-pdf' }, context: { uuid: '1' } },
          res: { content: `<script>console.log('foo')</script>`, meta: {} }
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.req.context.logs.map(l => l.message).should.containEql('foo')
      })
  })

  it('should propagate syntax errors from engine handlebars', () => {
    return request
      .post('/')
      .send(encodePayload({
        type: 'scriptManager',
        data: {
          inputs: {
            safeSandboxPath: require.resolve('jsreport-core/lib/render/safeSandbox.js'),
            engine: require.resolve('jsreport-handlebars/lib/handlebarsEngine.js'),
            template: { content: '{{#each}}' }
          },
          options: {
            execModulePath: require.resolve('jsreport-core/lib/render/engineScript.js')
          }
        }
      }))

      .expect(400)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.message.should.be.containEql('{{#each')
      })
  })

  it('should be able to run scripts', () => {
    return request
      .post('/')
      .send(encodePayload({
        type: 'scriptManager',
        data: {
          inputs: {
            method: 'beforeRender',
            script: `function beforeRender(req, res) { console.log('foo'); req.template.content = 'foo' }`,
            request: { template: {}, context: {} },
            response: {},
            safeSandboxPath: require.resolve('jsreport-core/lib/render/safeSandbox.js')
          },
          options: {
            execModulePath: require.resolve('jsreport-scripts/lib/scriptEvalChild.js')
          }
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.logs.map(l => l.message).should.containEql('foo')
        body.request.template.content.should.be.eql('foo')
      })
  })

  it('should be able to run recipe chrome-pdf and callback for header', async () => {
    const res = await request
      .post('/')
      .send(encodePayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'chrome-pdf',
              chrome: { headerTemplate: 'foo' }
            },
            context: { uuid: '1' } },
          res: { content: 'Hello', meta: {} }
        }
      }))
      .expect(200)

    decodeResponse(res.body).action.should.be.eql('render')

    return request
      .post('/')
      .send(encodePayload({
        uuid: '1',
        data: { content: 'Hello' }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })
  })

  it('should be able to run multiple recipe phantom-pdf and callback for header', async () => {
    const res = await request
      .post('/')
      .send(encodePayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'phantom-pdf',
              phantom: { header: 'foo' }
            },
            context: { uuid: '1' } },
          res: { content: 'Hello', meta: {} }
        }
      }))
      .expect(200)

    decodeResponse(res.body).action.should.be.eql('render')

    await request
      .post('/')
      .send(encodePayload({
        uuid: '1',
        data: { content: 'Hello' }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })

    const secondRes = await request
      .post('/')
      .send(encodePayload({
        type: 'recipe',
        uuid: '2',
        data: {
          req: {
            template: {
              recipe: 'phantom-pdf',
              phantom: { header: 'foo' }
            },
            context: { uuid: '2' } },
          res: { content: 'Hello', meta: {} }
        }
      }))
      .expect(200)

    decodeResponse(secondRes.body).action.should.be.eql('render')

    await request
      .post('/')
      .send(encodePayload({
        uuid: '2',
        data: { content: 'Hello' }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })
  })

  it('should propagate error from wkhtmltopdf', async () => {
    const res = await request
      .post('/')
      .send(encodePayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'wkhtmltopdf',
              wkhtmltopdf: { header: `<!DOCTYPE html>
              <html>
              <body>
                  Header...
              </body>
              </html>`,
              headerHeight: 'xxxx' }
            },
            context: { uuid: '1' } },
          res: { content: 'Hello', meta: {} }
        }
      }))
      .expect(200)

    decodeResponse(res.body).action.should.be.eql('render')

    await request
      .post('/')
      .send(encodePayload({
        uuid: '1',
        data: { content: 'Hello' }
      }))
      .expect(400)
      .expect((res) => {
        const body = decodeResponse(res.body)
        body.message.should.containEql('Invalid argument')
      })
  })
})
