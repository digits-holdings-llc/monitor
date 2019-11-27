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
var csv = require('csv-express')

// Parse JSON bodies (as sent by API clients)
app.use(express.json());
app.use(express.urlencoded());
app.engine('pug', require('pug').__express)
app.set('view engine', 'pug')
app.set('views', './views')
app.use(express.static('public'))
botSDK.init(app, http)

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
    catch (error) {
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
    const client = await MongoClient.connect(mongoURL).catch(err => {botSDK.log("Mongo Client Connect error", err)})

    try {
        const db = client.db(DB_NAME)
        let respColl = db.collection('messages')
        var responses = await respColl.find({}, {sort: {createdAt: 1}, projection: {_id: 0, createdAt: 1, src: 1, dst: 1, txt: 1, direction: 1, network: 1}}).toArray()
        response.csv(responses, true)
    } 
    catch (err) {
        botSDK.log(err);
    } 
    finally {
        client.close();
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
        response.send({})
        return;      
    }  

    await saveMessage(inboundMsg.msg)
  
    botSDK.log("New message : ", inboundMsg.msg.src, ":", inboundMsg.msg.txt)
})

http.listen(port, () => botSDK.log(`Automation running on ${port}!`))