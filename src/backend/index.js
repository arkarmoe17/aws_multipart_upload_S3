const express = require("express")
const { readdirSync } = require("fs")
const { join } = require("path")
const cors = require('cors')

const app = express()

const PORT = process.env.PORT || 3001

app.use(function (req, res, next) {

  // Website you wish to allow to connect
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Request methods you wish to allow
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

  // Request headers you wish to allow
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

  // Set to true if you need the website to include cookies in the requests sent
  // to the API (e.g. in case you use sessions)
  res.setHeader('Access-Control-Allow-Credentials', true);

  // Pass to next layer of middleware
  next();
});
app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

readdirSync(join(__dirname, "routes"))
  .filter((file) => {
    return file.indexOf(".") !== 0 && file.slice(-3) === ".js"
  })
  .forEach((file) => {
    const router = require(join(__dirname, "routes", file)).router
    app.use(router)
  })

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`)
})
