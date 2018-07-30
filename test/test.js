const supertest = require('supertest')
const Worker = require('../')
require('should')

function encodeRequestPayload (payload) {
  return {
    payload: payload
  }
}

function encodeRenderResContent (data) {
  return (Buffer.isBuffer(data) ? data : Buffer.from(data)).toString('base64')
}

function decodeResponsePayload (responseBody) {
  if (!responseBody.payload) {
    // body is coming from error response
    return responseBody
  }

  return responseBody.payload
}

describe('worker', () => {
  let worker
  let request

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
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: { template: { recipe: 'chrome-pdf' }, context: { uuid: '1' } },
          res: { content: encodeRenderResContent('Hello'), meta: {} }
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })
  })

  it('should be able to run engine handlebars', () => {
    return request
      .post('/')
      .send(encodeRequestPayload({
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
        const body = decodeResponsePayload(res.body)
        body.logs.should.be.of.Array()
        body.content.should.be.eql('foo hello')
      })
  })

  it('should be able to run recipe chrome-pdf and propagate logs', () => {
    return request
      .post('/')
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: { template: { recipe: 'chrome-pdf' }, context: { uuid: '1' } },
          res: {
            content: encodeRenderResContent(`<script>console.log('foo')</script>`),
            meta: {}
          }
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.req.context.logs.map(l => l.message).should.containEql('foo')
      })
  })

  it('should propagate syntax errors from engine handlebars', () => {
    return request
      .post('/')
      .send(encodeRequestPayload({
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
        const body = decodeResponsePayload(res.body)
        body.message.should.be.containEql('{{#each')
      })
  })

  it('should be able to run scripts', () => {
    return request
      .post('/')
      .send(encodeRequestPayload({
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
        const body = decodeResponsePayload(res.body)
        body.logs.map(l => l.message).should.containEql('foo')
        body.request.template.content.should.be.eql('foo')
      })
  })

  it('should be able to run recipe chrome-pdf and callback for header', async () => {
    const res = await request
      .post('/')
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'chrome-pdf',
              chrome: { headerTemplate: 'foo' }
            },
            context: { uuid: '1' }
          },
          res: { content: encodeRenderResContent('Hello'), meta: {} }
        }
      }))
      .expect(200)

    const resData = decodeResponsePayload(res.body)

    resData.action.should.be.eql('render')

    return request
      .post('/')
      .send(encodeRequestPayload({
        uuid: '1',
        data: {
          content: encodeRenderResContent('Hello'),
          req: resData.data.req
        }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })
  })

  it('should be able to run multiple recipe phantom-pdf and callback for header', async () => {
    const res = await request
      .post('/')
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'phantom-pdf',
              phantom: { header: 'foo' }
            },
            context: { uuid: '1' }
          },
          res: { content: encodeRenderResContent('Hello'), meta: {} }
        }
      }))
      .expect(200)

    let resData = decodeResponsePayload(res.body)

    resData.action.should.be.eql('render')

    await request
      .post('/')
      .send(encodeRequestPayload({
        uuid: '1',
        data: { content: encodeRenderResContent('Hello'), req: resData.data.req }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })

    const secondRes = await request
      .post('/')
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '2',
        data: {
          req: {
            template: {
              recipe: 'phantom-pdf',
              phantom: { header: 'foo' }
            },
            context: { uuid: '2' } },
          res: { content: encodeRenderResContent('Hello'), meta: {} }
        }
      }))
      .expect(200)

    resData = decodeResponsePayload(secondRes.body)

    resData.action.should.be.eql('render')

    await request
      .post('/')
      .send(encodeRequestPayload({
        uuid: '2',
        data: { content: encodeRenderResContent('Hello'), req: resData.data.req }
      }))
      .expect(200)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.res.meta.contentType.should.be.eql('application/pdf')
        body.res.content.should.be.of.type('string')
      })
  })

  it('should propagate error from wkhtmltopdf', async () => {
    const res = await request
      .post('/')
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'wkhtmltopdf',
              wkhtmltopdf: { header: `
                <!DOCTYPE html>
                <html>
                <body>
                    Header...
                </body>
                </html>
              `,
              headerHeight: 'xxxx' }
            },
            context: { uuid: '1' } },
          res: { content: encodeRenderResContent('Hello'), meta: {} }
        }
      }))
      .expect(200)

    const resData = decodeResponsePayload(res.body)

    resData.action.should.be.eql('render')

    await request
      .post('/')
      .send(encodeRequestPayload({
        uuid: '1',
        data: { content: encodeRenderResContent('Hello'), req: resData.data.req }
      }))
      .expect(400)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.message.should.containEql('Invalid argument')
      })
  })
})

describe('worker with unexpected error', async () => {
  let worker
  let request
  let chromeTimeout = 2000

  beforeEach(async () => {
    worker = Worker({
      httpPort: 3000,
      scriptManager: { strategy: 'in-process' },
      extensions: {
        'chrome-pdf': {
          timeout: chromeTimeout,
          launchOptions: {
            args: ['--no-sandbox']
          }
        }
      },
      workerCallbackTimeout: 4000,
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

  it('should not hang and fail normally when there is worker error in between of request callback', async () => {
    const res = await request
      .post('/')
      .send(encodeRequestPayload({
        type: 'recipe',
        uuid: '1',
        data: {
          req: {
            template: {
              recipe: 'chrome-pdf',
              chrome: { headerTemplate: 'foo' }
            },
            context: { uuid: '1' } },
          res: { content: encodeRenderResContent('Hello'), meta: {} }
        }
      }))
      .expect(200)

    const resData = decodeResponsePayload(res.body)

    resData.action.should.be.eql('render')

    // this delay makes the chrome's header render to fail with timeout error
    // which in the end is not propagated anywhere because there is no active http
    // connection to respond
    await new Promise((resolve) => {
      setTimeout(resolve, chromeTimeout + 500)
    })

    return request
      .post('/')
      .send(encodeRequestPayload({
        uuid: '1',
        data: {
          content: encodeRenderResContent('Hello'),
          req: resData.data.req
        }
      }))
      .expect(400)
      .expect((res) => {
        const body = decodeResponsePayload(res.body)
        body.message.should.containEql('Timeout while waiting for request callback response')
      })
  })
})
