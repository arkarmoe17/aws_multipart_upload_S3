import axios from "axios"
const uuid = require('uuid').v4;
// initializing axios
const api = axios.create({
  baseURL: "http://localhost:3000"
})

// original source: https://github.com/pilovm/multithreaded-uploader/blob/master/frontend/uploader.js
export class Uploader {
  constructor(options) {
    // this must be bigger than or equal to 5MB,
    // otherwise AWS will respond with:
    // "Your proposed upload is smaller than the minimum allowed size"
    this.chunkSize = options.chunkSize || 1024 * 1024 * 10; // 5MB
    // number of parallel uploads
    this.threadsQuantity = Math.min(options.threadsQuantity || 5, 15)
    this.file = options.file
    this.fileName = `${uuid()}_${this.file.name}`
    this.aborted = false
    this.uploadedSize = 0
    this.progressCache = {}
    this.activeConnections = {}
    this.parts = []
    this.uploadedParts = []
    this.fileId = null
    this.fileKey = null
    this.onProgressFn = () => { }
    this.onErrorFn = () => { }
  }

  start() {
    this.initialize()
  }

  async initialize() {
    try {
      // adding the the file extension (if present) to fileName
      let fileName = this.fileName
      console.log("Filename:", fileName);
      // const ext = this.file.name.split(".").pop()
      // if (ext) {
      //   fileName += `.${ext}`
      // }

      // initializing the multipart request
      const videoInitializationUploadInput = {
        name: fileName,
      }

      const initializeReponse = await api.request({
        url: "/uploads/initializeMultipartUpload",
        method: "POST",
        data: videoInitializationUploadInput,
      })

      const AWSFileDataOutput = initializeReponse.data

      this.fileId = AWSFileDataOutput.fileId // uploadID
      this.fileKey = AWSFileDataOutput.fileKey // fileName

      // retrieving the pre-signed URLs
      const numberOfparts = Math.ceil(this.file.size / this.chunkSize)

      //PAYLOAD:: 2
      const AWSMultipartFileDataInput = {
        fileId: this.fileId,
        fileKey: this.fileKey,
        parts: numberOfparts
      }

      const urlsResponse = await api.request({
        url: "/uploads/getMultipartPreSignedUrls",
        method: "POST",
        data: AWSMultipartFileDataInput,
      })

      console.log("urlsResponse:", urlsResponse);

      const newParts = urlsResponse.data.parts
      this.parts.push(...newParts)

      console.log("Parts[]:", this.parts);


      this.sendNext()
    } catch (error) {
      await this.complete(error)
    }
  }

  sendNext() {
    const activeConnections = Object.keys(this.activeConnections).length
    console.log("The active connections are ", activeConnections)
    if (activeConnections >= this.threadsQuantity) {
      return
    }

    if (!this.parts.length) {
      console.log("This is parts length null")
      if (!activeConnections) {
        console.log("This is send next complete")
        this.complete()
      }

      return
    }

    const part = this.parts.pop()
    console.log("Part:", part);

    if (this.file && part) {
      console.log("PartNumber:", part.PartNumber);
      const sentSize = (part.PartNumber - 1) * this.chunkSize // 3 * 10MB  = 40MB -46MB
      console.log("SendSize:", sentSize);
      const chunk = this.file.slice(sentSize, sentSize + this.chunkSize) //30-40 = 10MB

      const sendChunkStarted = () => {
        this.sendNext()
      }

      // chunk , partNumber
      this.sendChunk(chunk, part, sendChunkStarted)
        .then(() => {
          console.log("This is send chunk send next")
          this.sendNext()
        })
        .catch((error) => {
          console.log("Send Chunk Error : ", error)
          this.parts.push(part)

          console.log("Part Arr : ", this.parts)
          this.complete(error)
        })
    }
  }

  async complete(error) {
    console.log("This is complete function. ")
    console.log("This is error : ", error)
    if (error && !this.aborted) {
      this.onErrorFn(error)
      return
    }

    if (error) {
      this.onErrorFn(error)
      return
    }

    try {
      await this.sendCompleteRequest()
    } catch (error) {
      this.onErrorFn(error)
    }
  }

  async sendCompleteRequest() {

    if (this.fileId && this.fileKey) {
      const videoFinalizationMultiPartInput = {
        fileId: this.fileId,
        fileKey: this.fileKey,
        parts: this.uploadedParts,
      }

      console.log("Final:", videoFinalizationMultiPartInput);

      await api.request({
        url: "/uploads/finalizeMultipartUpload",
        method: "POST",
        header: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
          "Access-Control-Allow-Methods": "*"
        },
        data: videoFinalizationMultiPartInput,
      })
    }
  }

  sendChunk(chunk, part, sendChunkStarted) {
    console.log("Chunk : ", chunk)
    return new Promise((resolve, reject) => {
      this.upload(chunk, part, sendChunkStarted)
        .then((status) => {
          if (status !== 200) {
            reject(new Error("Failed chunk upload"))
            return
          }

          resolve()
        })
        .catch((error) => {
          reject(error)
        })
    })
  }

  handleProgress(part, event) {
    if (this.file) {
      if (event.type === "progress" || event.type === "error" || event.type === "abort") {
        this.progressCache[part] = event.loaded
      }

      if (event.type === "uploaded") {
        this.uploadedSize += this.progressCache[part] || 0
        delete this.progressCache[part]
      }

      const inProgress = Object.keys(this.progressCache)
        .map(Number)
        .reduce((memo, id) => (memo += this.progressCache[id]), 0)

      const sent = Math.min(this.uploadedSize + inProgress, this.file.size)

      const total = this.file.size
      console.log("Total :", total);

      const percentage = Math.round((sent / total) * 100)

      this.onProgressFn({
        sent: sent,
        total: total,
        percentage: percentage,
      })
    }
  }

  upload(file, part, sendChunkStarted) {
    // uploading each part with its pre-signed URL
    return new Promise((resolve, reject) => {
      if (this.fileId && this.fileKey) {
        const xhr = (this.activeConnections[part.PartNumber - 1] = new XMLHttpRequest())

        sendChunkStarted()

        const progressListener = this.handleProgress.bind(this, part.PartNumber - 1)

        xhr.upload.addEventListener("progress", progressListener)

        xhr.addEventListener("error", progressListener)
        xhr.addEventListener("abort", progressListener)
        xhr.addEventListener("loadend", progressListener)

        xhr.open("PUT", part.signedUrl)

        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4 && xhr.status === 200) {
            console.log("Here is on ready state change", xhr.getAllResponseHeaders())
            // const ETag = xhr.getAllResponseHeaders("ETag")
            
            var headers = xhr.getAllResponseHeaders();
            var arr = headers.trim().split(/[\r\n]+/);

            // Create a map of header names to values
            var headerMap = {};
            arr.forEach(function (line) {
              var parts = line.split(': ');
              var header = parts.shift();
              var value = parts.join(': ');
              headerMap[header] = value;
            });

            const ETag = headerMap["etag"];
            console.log("ETag: ", ETag);

            if (ETag) {
              const uploadedPart = {
                PartNumber: part.PartNumber,
                ETag: ETag.replaceAll('"', ""),
              }
              console.log("ETag after change ", uploadedPart)

              this.uploadedParts.push(uploadedPart)

              console.log("UPLOAD PARTS:", this.uploadedParts);

              resolve(xhr.status)
              delete this.activeConnections[part.PartNumber - 1]
            }
          }
        }

        xhr.onerror = (error) => {
          reject(error)
          delete this.activeConnections[part.PartNumber - 1]
        }

        xhr.onabort = () => {
          reject(new Error("Upload canceled by user"))
          delete this.activeConnections[part.PartNumber - 1]
        }

        xhr.send(file)
      }
    })
  }

  onProgress(onProgress) {
    this.onProgressFn = onProgress
    return this
  }

  onError(onError) {
    this.onErrorFn = onError
    return this
  }

  abort() {
    Object.keys(this.activeConnections)
      .map(Number)
      .forEach((id) => {
        this.activeConnections[id].abort()
      })

    this.aborted = true
  }
}
