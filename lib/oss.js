var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value)
          })
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value))
        } catch (e) {
          reject(e)
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value))
        } catch (e) {
          reject(e)
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected)
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next())
    })
  }
const chokidar = require('chokidar')
const mime = require('mime')
const ALY = require('aliyun-sdk')
const path = require('path')
const fs = require('fs')
const url = require('url')
const crypto = require('crypto')

module.exports = function (options) {
  return __awaiter(this, void 0, void 0, function* () {
    //create OSS instance
    //options.oss.apiVersion = options.oss.apiVersion || '2013-10-15';
    if (!options.AccessKeySecret) {
      throw new Error('Please provide AccessKeySecret.')
    }
    if (!options.AccessKeyId) {
      throw new Error('Please provide AccessKeyId.')
    }
    options.oss.accessKeyId = options.AccessKeyId
    options.oss.secretAccessKey = options.AccessKeySecret
    options.oss.securityToken = options.oss.securityToken || ''
    options.oss.apiVersion = options.oss.apiVersion || '2013-10-15'
    if (!options.oss.endpoint && !options.oss.region) {
      throw new Error('Please provide oss endpoint or region.')
    }
    if (!options.oss.endpoint) {
      options.oss.endpoint =
        (options.oss.secure ? 'https' : 'http') +
        '://' +
        options.oss.region +
        (options.oss.internal ? '.internal' : '') +
        '.aliyuncs.com'
    }
    if (options.oss.secure === undefined) {
      options.cdn.secure = /https/.test(options.oss.endpoint)
    }
    let oss = new ALY.OSS(options.oss)
    //create cdn instance
    let cdn
    if (options.cdn) {
      options.cdn.accessKeyId = options.AccessKeyId
      options.cdn.secretAccessKey = options.AccessKeySecret
      options.cdn.endpoint = options.cdn.endpoint || 'https://cdn.aliyuncs.com'
      options.cdn.apiVersion = options.cdn.apiVersion || '2014-11-11'
      cdn = new ALY.CDN(options.cdn)
    }
    const cwd = options.syncDir || ''
    const cwdTo = options.syncTo || ''
    let getBuckets = function () {
      return new Promise(function (resolve, reject) {
        oss.listBuckets(function (err, list) {
          if (err) {
            reject(err)
          } else {
            resolve(list)
          }
        })
      })
    }
    let buckets = yield getBuckets()
    let bucketsList = buckets.Buckets
    let bucket
    for (let i = 0, l = bucketsList.length; i < l; i++) {
      if (options.oss.bucket.toUpperCase() === bucketsList[i].Name.toUpperCase()) {
        bucket = bucketsList[i]
      }
    }
    if (!bucket) {
      throw new Error('Can not find your bucket. Pleas check the bucket name again.')
    }
    //get cdn refresh quota
    if (options.oss.autoRefreshCDN && cdn) {
      let getCDNRefreshQuota = function () {
        return new Promise(function (resolve) {
          cdn.describeRefreshQuota(function (err, res) {
            resolve(res)
          })
        })
      }
      let res = yield getCDNRefreshQuota()
      options.cdn.refreshQuota = res.UrlRemain
      options.debug && console.log('Refresh CDN file quota: ' + options.cdn.refreshQuota)
    }
    //oss use unix type of file type
    const prefix = cwdTo.replace(/\\/g, '/')
    let getObjects = function (cb) {
      let nextMarker = ''
      let bucketObjects = []
      let getObjectsLoop = function () {
        if (typeof nextMarker === 'string') {
          oss.listObjects(
            {
              Bucket: bucket.Name,
              MaxKeys: 20,
              Prefix: prefix,
              Marker: nextMarker,
            },
            function (listObjectsErr, ossObject) {
              ossObject.Contents.forEach(function (o) {
                options.debug && console.log('Found bucket file: ', o.Key)
              })
              if (listObjectsErr) {
                throw new Error(listObjectsErr)
              }
              nextMarker = ossObject.NextMarker
              if (ossObject.NextMarker) {
                options.debug && console.log('next marker: ' + ossObject.NextMarker)
              } else {
                options.debug && console.log('Reach the end of the bucket.')
              }
              bucketObjects = bucketObjects.concat(ossObject.Contents)
              getObjectsLoop()
            }
          )
        } else {
          cb(bucketObjects)
          options.debug && console.log('Scan oss bucket finish.')
        }
      }
      getObjectsLoop()
    }
    getObjects(function (bucketObjects) {
      //get all path of the bucket
      let bucketPaths = []
      let localPaths = []
      for (let i = 0; i < bucketObjects.length; i++) {
        bucketPaths.push(bucketObjects[i].Key)
      }
      const pathsArr = Array.isArray(options.syncFilter) ? options.syncFilter : options.syncFilter.split(' ')
      for (let i = 0; i < pathsArr.length; i++) {
        if (pathsArr[i].startsWith('!')) {
          pathsArr[i] = pathsArr[i].replace('!', '')
          pathsArr[i] = '!' + path.join(cwd, pathsArr[i])
        } else {
          pathsArr[i] = path.join(cwd, pathsArr[i])
        }
      }
      //set watcher default config value
      options.watch = options.watch || {}
      let filesWatcher = chokidar.watch(pathsArr, options.watch)
      //upload or update file function
      let upsertFile = function (localFilePath) {
        let contentType = mime.getType(localFilePath)
        let standerFilePath = localFilePath.replace(/\\/g, '/')
        fs.readFile(localFilePath, function (readFileErr, fileData) {
          if (readFileErr) {
            throw readFileErr
          }
          const filename = standerFilePath.match(/[^\\\/]*$/)[0]
          const putConfig = {
            Bucket: bucket.Name,
            Body: fileData,
            Key: filename,
            ContentType: contentType,
            AccessControlAllowOrigin: options.AccessControlAllowOrigin || '*',
            CacheControl: options.CacheControl || 'no-cache',
            Expires: options.Expires || null,
          }
          if (options.contentEncoding) {
            putConfig.ContentEncoding = options.contentEncoding
          }
          oss.putObject(putConfig, function (putObjectErr) {
            if (putObjectErr) {
              console.error('error:', putObjectErr)
              return putObjectErr
            }
            console.log('upload success: ' + localFilePath)
            if (bucketPaths.indexOf(filename) === -1) {
              bucketPaths.push(filename)
            }
            if (localPaths.indexOf(filename) === -1) {
              localPaths.push(filename)
            }
            //refresh cdn
            if (options.oss.autoRefreshCDN && cdn) {
              if (options.cdn.refreshQuota < 1) {
                console.error('There is no refresh cdn url quota today.')
                return
              }
              let cdnDomain = ''
              if (/^http/.test(options.cdn.domain)) {
                cdnDomain = options.cdn.domain.replace(/^https?:?\/?\/?/, '')
                options.cdn.secure === undefined && (options.cdn.secure = /^https/.test(options.cdn.domein))
              } else {
                cdnDomain = options.cdn.domain
              }
              let cdnObjectPath = url.format({
                protocol: options.oss.secure ? 'https' : 'http',
                hostname: cdnDomain,
                pathname: standerFilePath,
              })
              options.debug && console.log('Refreshing CDN file: ', cdnObjectPath)
              cdn.refreshObjectCaches(
                {
                  ObjectType: 'File',
                  ObjectPath: cdnObjectPath,
                },
                function (refreshCDNErr) {
                  if (refreshCDNErr) {
                    console.error('refresh cdn error: ', refreshCDNErr)
                  } else {
                    options.cdn.refreshQuota--
                    console.log('Refresh cdn file success: ', cdnObjectPath)
                  }
                }
              )
            }
          })
        })
      }
      //delete bucket file function
      let deleteFile = function (filePath) {
        let standerPath = filePath.replace(/\\/g, '/')
        oss.deleteObject(
          {
            Bucket: bucket.Name,
            Key: standerPath,
          },
          function (err) {
            if (err) {
              console.log('error:', err)
              return err
            }
            let bucketIndex = bucketPaths.indexOf(standerPath)
            if (bucketIndex !== -1) {
              bucketPaths.splice(bucketIndex, 1)
            }
            let localIndex = localPaths.indexOf(standerPath)
            if (localIndex !== -1) {
              localPaths.splice(localIndex, 1)
            }
            console.log('delete success:' + standerPath)
          }
        )
      }
      //add new files
      filesWatcher.on('add', function (localFilePath) {
        let standerFilePath = localFilePath.replace(/\\/g, '/')
        let bucketIndex = bucketPaths.indexOf(standerFilePath)
        if (bucketIndex === -1) {
          options.debug && console.log('Bucket file not exist, uploading local file: ' + localFilePath)
          upsertFile(localFilePath)
        } else {
          if (localPaths.indexOf(standerFilePath) === -1) {
            localPaths.push(standerFilePath)
          }
          fs.readFile(localFilePath, function (readFileErr, fileData) {
            let fileMd5 = crypto.createHash('md5').update(fileData).digest('hex').toUpperCase()
            for (let i = 0; i < bucketObjects.length; i++) {
              if (bucketObjects[i].Key === standerFilePath) {
                if (bucketObjects[i].ETag.replace(/"/g, '') !== fileMd5) {
                  options.debug && console.log('ETag different, uploading local file: ' + localFilePath)
                  upsertFile(localFilePath)
                }
              }
            }
          })
        }
      })
      //Initial scan complete.
      filesWatcher.on('ready', function () {
        //delete bucket object if local object is not exist.
        for (let i = 0; i < bucketPaths.length; i++) {
          if (localPaths.indexOf(bucketPaths[i]) === -1) {
            let filePath = bucketPaths[i]
            options.debug && console.log('No this local file found, deleting: ', filePath)
            deleteFile(filePath)
          }
        }
        options.debug && console.log('Scanning local file finish.')
        if (options.keepWatching !== true) {
          filesWatcher.close()
          console.log('Sync files watcher closed.')
          return
        }
        console.log('Sync files watcher running...')
      })
      //modify file
      filesWatcher.on('change', function (filePath) {
        console.log('Local file change, uploading: ' + filePath)
        upsertFile(filePath)
      })
      //delete file
      filesWatcher.on('unlink', function (filePath) {
        console.log('Deleting bucket file: ' + filePath)
        deleteFile(filePath)
      })
    })
  })
}
