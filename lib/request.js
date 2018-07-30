const Promise = require('bluebird')

module.exports = (uuid, { data }, { onSuccess, onError, callbackTimeout }) => {
  return {
    data,
    callback (resp) {
      return new Promise((resolve, reject) => {
        this._resolve(resp)
        this._resolve = resolve
        this._reject = reject
      })
    },
    process (httpReq, execPromiseFn) {
      this._currentHttpReq = httpReq

      return new Promise((resolve, reject) => {
        this._resolve = resolve
        this._reject = reject
        execPromiseFn().then((d) => {
          onSuccess({
            uuid,
            httpReq: this._currentHttpReq,
            data: d
          })

          this._resolve(d)
        }).catch((e) => {
          onError({
            uuid,
            httpReq: this._currentHttpReq,
            error: e
          })

          this._reject(e)
        })
      })
    },
    processCallbackResponse (httpReq, { data }) {
      this._currentHttpReq = httpReq

      let timeoutId

      return new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error(`Timeout while waiting for request callback response after ${callbackTimeout}ms`)

          onError({
            uuid,
            httpReq: this._currentHttpReq,
            error: timeoutError
          })

          this._reject(timeoutError)
        }, callbackTimeout)

        this._resolve(data)
        this._resolve = resolve
        this._reject = reject
      }).then((result) => {
        clearTimeout(timeoutId)
        return result
      }).catch((err) => {
        clearTimeout(timeoutId)
        throw err
      })
    }
  }
}
