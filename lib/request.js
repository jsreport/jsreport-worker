const Promise = require('bluebird')

module.exports = ({ data }) => {
  return {
    data,
    callback (resp) {
      return new Promise((resolve) => {
        this._resolve(resp)
        this._resolve = resolve
      })
    },
    process (execPromise) {
      return new Promise((resolve, reject) => {
        this._resolve = resolve
        execPromise.then((d) => {
          this._resolve(d)
        }).catch(reject)
      })
    },
    processCallbackResponse ({ data }) {
      return new Promise((resolve) => {
        this._resolve(data)
        this._resolve = resolve
      })
    }
  }
}
