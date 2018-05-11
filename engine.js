const pckg = require('./package.json')
const cache = {}

module.exports = (reporter, opts) => {
  if (!cache[opts.engine]) {
    require(pckg.jsreport.engines[opts.engine])().main(reporter, { options: {} })
    cache[opts.engine] = reporter.engine.find((r) => r.name === opts.engine)
  }

  return cache[opts.engine](opts.req, opts.res)
}
