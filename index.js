const express = require('express')
const app = express()
var http = require('http').createServer(app);

const port = process.env.WEB_PORT || 80
var MongoClient = require('mongodb').MongoClient
const { GraphQLClient } = require('graphql-request')
const mongoURL = process.env.MONGO_URL || 'mongodb://localhost:27017/monitor'
const parts = mongoURL.split("/")
const DB_NAME = parts[parts.length - 1]
var botSDK = require('greenbot-sdk')
var serveIndex = require('serve-index')
var shell = require('shelljs');

// Parse JSON bodies (as sent by API clients)
app.use(express.json());
app.use(express.urlencoded());
app.engine('pug', require('pug').__express)
app.set('view engine', 'pug')
app.set('views', './views')
app.use(express.static('public'))
botSDK.init(app, http)

function getCsvExportCommandText() {
    var filename = 'download-' + Date.now() + '.csv'
    return {commandLine: ['mongoexport', "--uri=\"" + mongoURL + "\"", '--fields=_id,createdAt,src,dst,txt,direction,network', '--collection=messages', '--type=csv', '--out=exports/' + filename].join(" "), filename: filename}
}

async function getCsvExportCommand(commandLine) {
    var result = await shell.exec(commandLine)
    console.log(result.code)
    if (result.code !== 0) {
      throw "CSV export command failed with code: " + result.code
    }
}

app.get('/', async function(request, response) {
    await getMessages(request, response)
})

async function saveMessage(message) {
    const client = await MongoClient.connect(mongoURL).catch(err => {console.log("Mongo Client Connect error", err)})

    try {
        const db = client.db(DB_NAME)
        let messagesCollection = db.collection('messages')
        await messagesCollection.insertOne(message)
    }
    catch (err) {
        botSDK.log(err);

    } 
    finally {
        client.close();
    }
}

async function getMessages(request, response) {
    const client = await MongoClient.connect(mongoURL).catch(err => {botSDK.log("Mongo Client Connect error", err)})

    try {
        const db = client.db(DB_NAME)
        let respColl = db.collection('messages')
        var responses = await respColl.find({}, {sort: {createdAt: -1}, limit: 10}).toArray()
        response.render('index', { responses, config: request.config})
    } 
    catch (err) {
        botSDK.log(err);
    } 
    finally {
        client.close();
    }
}

async function getDownloadCsv(request, response) {
    var file = getCsvExportCommandText()
    console.log(file.commandLine)
    console.log(file.filename)

    try {
        var result = await getCsvExportCommand(file.commandLine)
        response.redirect("/exports/" + file.filename)
    } 
    catch (err) {
        botSDK.log(err);
        response.sendStatus(500)
    } 
}

app.get('/download.csv', async function(request, response) {
    await getDownloadCsv(request, response)
  })

// Access the parse results as request.body
app.post('/', async function(request, response){
  var inboundMsg = request.body;
  
    // If this is a session end event, ignore
    if (inboundMsg.type == 'session_end' || inboundMsg.type == 'new_session') {
        response.send({})
        return;
    }
    if (!inboundMsg.msg) {
        response.send({})
        return;
    } 
  if (request.body.msg.direction == "egress") {
    if (request.config.egress.toUpperCase().trim() == "FALSE") {
      response.send({})
      return;      
    }
  }  
  if (request.body.msg.direction == "ingress") {
    if (request.config.ingress.toUpperCase().trim() == "FALSE") {
      response.send({})
      return;      
    }
  }  

  var direction = inboundMsg.msg.direction || "whisper"
  botSDK.log("New message : ", direction, ":", inboundMsg.msg.src, "->", inboundMsg.msg.dst, ":",  inboundMsg.msg.txt)
  await saveMessage(inboundMsg.msg)
  response.send({})
  
})

app.use('/exports', express.static('exports'), serveIndex('exports', {'icons': true}))
http.listen(port, () => botSDK.log(`Automation running on ${port}!`))
