const supertest = require('supertest')
const Worker = require('../')
require('should')

describe('worker', () => {
  let request
  let worker

  beforeEach(() => {
    worker = Worker({ httpPort: 5488, scriptManager: { strategy: 'in-process' } })
    request = supertest(worker.server)
  })

  afterEach(() => worker.close())

  it('should be able to run recipe chrome-pdf', () => {
    return request
      .post('/')
      .send({
        type: 'recipe',
        uuid: '1',
        data: {
          req: { template: { recipe: 'chrome-pdf' }, context: { uuid: '1' } },
          res: { content: 'Hello', meta: {} }
        }
      })
      .expect(200)
      .expect((res) => {
        res.body.res.meta.contentType.should.be.eql('application/pdf')
        res.body.res.content.should.be.of.type('string')
      })
  })

  it('should be able to run engine handlebars', () => {
    return request
      .post('/')
      .send({
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
      })
      .expect(200)
      .expect((res) => {
        res.body.logs.should.be.of.Array()
        res.body.content.should.be.eql('foo hello')
      })
  })

  it('should be able to run recipe chrome-pdf and propagate logs', () => {
    return request
      .post('/')
      .send({
        type: 'recipe',
        uuid: '1',
        data: {
          req: { template: { recipe: 'chrome-pdf' }, context: { uuid: '1' } },
          res: { content: `<script>console.log('foo')</script>`, meta: {} }
        }
      })
      .expect(200)
      .expect((res) => {
        res.body.req.context.logs.map(l => l.message).should.containEql('foo')
      })
  })

  it('should propagate syntax errors from engine handlebars', () => {
    return request
      .post('/')
      .send({
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
      })

      .expect(400)
      .expect((res) => {
        res.body.message.should.be.containEql('{{#each')
      })
  })

  it('should be able to run scripts', () => {
    return request
      .post('/')
      .send({
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
      })
      .expect(200)
      .expect((res) => {
        res.body.logs.map(l => l.message).should.containEql('foo')
        res.body.request.template.content.should.be.eql('foo')
      })
  })

  it('should be able to run recipe chrome-pdf and callback for header', async () => {
    const res = await request
      .post('/')
      .send({
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
      })
      .expect(200)

    res.body.action.should.be.eql('render')

    return request
      .post('/')
      .send({
        uuid: '1',
        data: { content: 'Hello' }
      })
      .expect(200)
      .expect((res) => {
        res.body.res.meta.contentType.should.be.eql('application/pdf')
        res.body.res.content.should.be.of.type('string')
      })
  })
})
