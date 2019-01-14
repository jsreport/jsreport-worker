const util = require('util')
const path = require('path')
const fs = require('fs')
const set = require('lodash.set')
const readFileAsync = util.promisify(fs.readFile)
const writeFileAsync = util.promisify(fs.writeFile)

module.exports = ({ addRequestFilterListener, addResponseFilterListener }) => {
  addRequestFilterListener('generalFilter', async ({ type, reqData, meta }) => {
    const filesToRead = []
    let data

    if (reqData.data) {
      data = Object.assign({}, reqData.data)
    } else {
      data = {}
    }

    if (type === 'scriptManager') {
      if (data.content) {
        filesToRead.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, data.content.file),
          type: data.content.type,
          propPath: 'content'
        })
      }

      if (data.inputs) {
        if (data.inputs.template && data.inputs.template.content) {
          filesToRead.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, data.inputs.template.content.file),
            type: data.inputs.template.content.type,
            propPath: 'inputs.template.content'
          })
        }

        if (data.inputs.request && data.inputs.request.template && data.inputs.request.template.content) {
          filesToRead.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, data.inputs.request.template.content.file),
            type: data.inputs.request.template.content.type,
            propPath: 'inputs.request.template.content'
          })
        }

        if (data.inputs.response && data.inputs.response.content) {
          filesToRead.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, data.inputs.response.content.file),
            type: data.inputs.response.content.type,
            propPath: 'inputs.response.content'
          })
        }

        if (data.inputs.pdfContent) {
          filesToRead.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, data.inputs.pdfContent.file),
            type: data.inputs.pdfContent.type,
            propPath: 'inputs.pdfContent'
          })
        }
      }

      if (data.req && data.req.template && data.req.template.content) {
        filesToRead.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, data.req.template.content.file),
          type: data.req.template.content.type,
          propPath: 'req.template.content'
        })
      }
    } else if (type === 'recipe') {
      if (data.content) {
        filesToRead.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, data.content.file),
          type: data.content.type,
          propPath: 'content'
        })
      }

      if (data.req && data.req.template && data.req.template.content) {
        filesToRead.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, data.req.template.content.file),
          type: data.req.template.content.type,
          propPath: 'req.template.content'
        })
      }

      if (data.res && data.res.content) {
        filesToRead.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, data.res.content.file),
          type: data.res.content.type,
          propPath: 'res.content'
        })
      }
    }

    if (filesToRead.length > 0) {
      await Promise.all(filesToRead.map(async (info) => {
        await readContentFileAndRestore(
          data,
          info.propPath,
          info.path,
          info.type
        )
      }))

      reqData.data = data
      return reqData
    }
  })

  addResponseFilterListener('generalFilter', async ({ type, resData, meta }) => {
    const uuid = meta.uuid

    const filesToSave = []
    const data = resData

    if (type === 'scriptManager') {
      if (data.action != null && data.data) {
        if (data.data.parentReq && data.data.parentReq.template && data.data.parentReq.template.content) {
          const tmpFilename = `${type}-${uuid}-response-action-parentReq-template.txt`

          filesToSave.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
            file: tmpFilename,
            propPath: 'data.parentReq.template.content',
            content: data.data.parentReq.template.content
          })
        }

        if (data.data.req && data.data.req.template && data.data.req.template.content) {
          const tmpFilename = `${type}-${uuid}-response-action-req-template.txt`

          filesToSave.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
            file: tmpFilename,
            propPath: 'data.req.template.content',
            content: data.data.req.template.content
          })
        }

        if (data.data.originalReq && data.data.originalReq.template && data.data.originalReq.template.content) {
          const tmpFilename = `${type}-${uuid}-response-action-originalReq-template.txt`

          filesToSave.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
            file: tmpFilename,
            propPath: 'data.originalReq.template.content',
            content: data.data.originalReq.template.content
          })
        }
      }

      if (data.content) {
        const tmpFilename = `${type}-${uuid}-response-content.txt`

        filesToSave.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
          file: tmpFilename,
          propPath: 'content',
          content: data.content
        })
      }

      if (data.request && data.request.template && data.request.template.content) {
        const tmpFilename = `${type}-${uuid}-response-req-template.txt`

        filesToSave.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
          file: tmpFilename,
          propPath: 'request.template.content',
          content: data.request.template.content
        })
      }

      if (data.response && data.response.content) {
        const tmpFilename = `${type}-${uuid}-response-res-content.txt`

        filesToSave.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
          file: tmpFilename,
          propPath: 'response.content',
          content: data.response.content
        })
      }

      if (data.pdfContent) {
        const tmpFilename = `${type}-${uuid}-response-pdfcontent.txt`

        filesToSave.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
          file: tmpFilename,
          propPath: 'pdfContent',
          content: data.pdfContent
        })
      }
    } else if (type === 'recipe') {
      if (data.action != null && data.data) {
        if (data.data.parentReq && data.data.parentReq.template && data.data.parentReq.template.content) {
          const tmpFilename = `${type}-${uuid}-response-action-parentReq-template.txt`

          filesToSave.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
            file: tmpFilename,
            propPath: 'data.parentReq.template.content',
            content: data.data.parentReq.template.content
          })
        }

        if (data.data.req && data.data.req.template && data.data.req.template.content) {
          const tmpFilename = `${type}-${uuid}-response-action-req-template.txt`

          filesToSave.push({
            path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
            file: tmpFilename,
            propPath: 'data.req.template.content',
            content: data.data.req.template.content
          })
        }
      }

      if (data.req && data.req.template && data.req.template.content) {
        const tmpFilename = `${type}-${uuid}-response-req-template.txt`

        filesToSave.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
          file: tmpFilename,
          propPath: 'req.template.content',
          content: data.req.template.content
        })
      }

      if (data.res && data.res.content) {
        const tmpFilename = `${type}-${uuid}-response-res-content.txt`

        filesToSave.push({
          path: path.join(meta.requestAutoCleanupTempDirectory, tmpFilename),
          file: tmpFilename,
          propPath: 'res.content',
          content: data.res.content
        })
      }
    }

    if (filesToSave.length > 0) {
      await Promise.all(filesToSave.map(async (info) => {
        await saveContentFileAndUpdate(
          data,
          info.propPath,
          info.file,
          info.path,
          info.content
        )
      }))

      return data
    }
  })
}

async function saveContentFileAndUpdate (data, propPath, file, pathToSave, content) {
  const parts = propPath.split('.')
  const partsLastIndex = parts.length - 1
  let parent = data

  parts.forEach((part, idx) => {
    if (idx === partsLastIndex) {
      parent[part] = {
        type: typeof content === 'string' ? 'string' : 'buffer',
        file
      }
    } else {
      parent[part] = Object.assign({}, parent[part])
      parent = parent[part]
    }
  })

  await writeFileAsync(pathToSave, content)
}

async function readContentFileAndRestore (data, propPath, pathToContent, type) {
  let content = await readFileAsync(pathToContent)

  if (type !== 'string' && type !== 'buffer') {
    throw new Error(`Invalid content type "${type}" found when trying to read content from temp file`)
  }

  if (type === 'string') {
    content = content.toString()
  }

  set(data, propPath, content)
}
