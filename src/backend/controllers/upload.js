require('dotenv').config();
const AWS = require("aws-sdk")
const { orderBy } = require("lodash")

// TODO: insert the valid endpoint here
// const s3Endpoint = new AWS.Endpoint('') 

// TODO: insert your credentials here
// const s3Credentials = new AWS.Credentials({
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
// })

// const s3 = new AWS.S3({
//   endpoint: s3Endpoint,
//   credentials: s3Credentials,
// })
const s3 = new AWS.S3();

// TODO: insert your bucket name here
const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

const UploadController = {

  initializeMultipartUpload: async (req, res) => {
    const { name } = req.body

    const multipartParams = {
      Bucket: BUCKET_NAME,
      Key: `chunk/${name}`,
      ACL: 'public-read',
    }

    const multipartUpload = await s3.createMultipartUpload(multipartParams).promise()
    console.log("Multipart upload:", multipartUpload);
    res.send({
      fileId: multipartUpload.UploadId,
      fileKey: multipartUpload.Key,
    })
  },

  getMultipartPreSignedUrls: async (req, res) => {
    console.log("getMultipartPreSignedUrls:", req.body);
    const { fileKey, fileId, parts } = req.body

    const multipartParams = {
      Bucket: BUCKET_NAME,
      Key: `${fileKey}`,
      UploadId: fileId,
    }

    const promises = []

    for (let index = 0; index < parts; index++) {
      promises.push(
        s3.getSignedUrlPromise("uploadPart", {
          ...multipartParams,
          PartNumber: index + 1,
        }),
      )
    }

    const signedUrls = await Promise.all(promises)

    const partSignedUrlList = signedUrls.map((signedUrl, index) => {
      return {
        signedUrl: signedUrl,
        PartNumber: index + 1,
      }
    })

    res.send({
      parts: partSignedUrlList,
    })
  },

  abortMultipartUpload: async (req, res) => {
    const { fileKey, fileId } = req.body
    const params = {
      Bucket: BUCKET_NAME,
      Key: `${fileKey}`,
      UploadId: `${fileId}`
    }
    s3.abortMultipartUpload(params, function (err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      console.log("Response:", data);           // successful response
      res.send(data)
    });
  },

  finalizeMultipartUpload: async (req, res) => {
    console.log("CALLING FINALIZE UPLOAD");
    const { fileId, fileKey, parts } = req.body
    console.log("Payload:", req.body);

    const multipartParams = {
      Bucket: BUCKET_NAME,
      Key: `${fileKey}`,
      UploadId: `${fileId}`,
      MultipartUpload: {
        // ordering the parts to make sure they are in the right order
        Parts: orderBy(parts, ["PartNumber"], ["asc"]),
      },
    }

    const result = await s3.completeMultipartUpload(multipartParams).promise()
    res.send(result)
  },
}

module.exports = { UploadController }
