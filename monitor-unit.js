#!/usr/bin/env node

const {
  createServer,
  IncomingMessage,
  ServerResponse,
} = require('unit-http');

const {
  PORT,
} = process.env;

// Must perform NGINX Unit check and set ServerResponse and IncomingMessage before initializing express app through vht-automations-sdk
if (!PORT) {
  console.error('no port specified');
  require('http').ServerResponse = ServerResponse;
  require('http').IncomingMessage = IncomingMessage;
}

/*
const SUBDOMAIN = process.env.SUBDOMAIN;
const MONGO_CLUSTER_URL = process.env.MONGO_CLUSTER_URL;
const MONGO_URL = `${MONGO_CLUSTER_URL}/${SUBDOMAIN}` || `mongodb://localhost:27017/${SUBDOMAIN}`;

//const { init, log, client } = require('greenbot-sdk');

const serveIndex = require('serve-index');
const shell = require('shelljs');
*/

const { initSDK, app } = require('vht-automations-sdk');

initSDK({ applicationName: "Monitor", pug_views: ["views"] })
  .then(() => {
    initializeRoutes();
    if (!PORT) {
      createServer(app).listen(); // nginx unit listen entry point
    }
    else {
      require('http').createServer(app).listen(PORT, () => {
        var startupMessage = `Started on ${PORT}`;
        console.log(startupMessage);
      });
    }
  }
);

const express = require('express');
app.use(express.static('public'));

function initializeRoutes() {
  app.get('/', async function (request, response) {
    await getMessages(request, response);
  });

  app.get('/counts', async function (request, response) {
    await getAllCounts(request, response);
  });

  app.get('/download.csv', async function (request, response) {
    await getDownloadCsv(request, response);
  });

  // Access the parse results as request.body
  app.post('/', async function (request, response) {
    const inboundMsg = request.body;

    // If this is a session end event, ignore
    if (inboundMsg.type == 'session_end' || inboundMsg.type == 'new_session') {
      response.send({});
      return;
    }
    if (!inboundMsg.msg) {
      response.send({});
      return;
    }
    if (request.body.msg.direction == 'egress') {
      if (request.config.egress.toUpperCase().trim() == 'FALSE') {
        response.send({});
        return;
      }
    }
    if (request.body.msg.direction == 'ingress') {
      if (request.config.ingress.toUpperCase().trim() == 'FALSE') {
        response.send({});
        return;
      }
    }

    const direction = inboundMsg.msg.direction || 'whisper';
    console.log('New message : ', direction, ':', inboundMsg.msg.src, '->', inboundMsg.msg.dst, ':', inboundMsg.msg.txt);
    await saveMessage(request, inboundMsg.msg);
    response.send({});
  });


}

/*
function getCsvExportCommandText() {
  const filename = `download-${Date.now()}.csv`;
  return {
    commandLine: [
      `mongoexport`,
      `--uri="${MONGO_URL}"`,
      '--fields=_id,createdAt,src,dst,txt,direction,network',
      '--collection=messages',
      '--type=csv',
      '--quiet'
    ].join(' '),
    filename
  };
}
*/

/*
function getCsvExportCommand(commandLine) {
  const result = shell.exec(commandLine, { silent: true, async: true });
  return result.stdout;
}
*/

async function saveMessage(request, message) {
  try {
    await request.mongoClient.connect();
    const db = request.mongoClient.db(request.mongoDatabaseName);
    let messagesCollection = db.collection('messages');
    await messagesCollection.insertOne(message);
  } 
  catch (err) {
    console.log(err);
  } 
  finally {
    await request.mongoClient.close();
  }
}

async function getMessages(request, response) {
  try {
    await request.mongoClient.connect();
    const db = request.mongoClient.db(request.mongoDatabaseName);
    const respColl = db.collection('messages');
    const responses = await respColl.find({}, { sort: { createdAt: -1 }, limit: 10 }).toArray();
    const version = process.env.COMMIT_HASH ? process.env.COMMIT_HASH : "";
    response.render('index', { responses, config: request.config,version });
  }
  catch (err) {
    console.log(err);
  }
  finally {
    await request.mongoClient.close();
  }
}

async function getAllCounts(request, response) {
    try {
      await request.mongoClient.connect();
      const db = request.mongoClient.db(request.mongoDatabaseName);
      const col = db.collection('messages');
      const ingressTotal = col.find({direction: "ingress"}).count(); 
      const egressTotal = col.find({direction: "egress"}).count(); 
      const ingressQuit = col.find({txt: /^quit$/i, direction: "ingress"}).count(); 
      const egressSaucy = col.find({"txt" : {$regex : ".*saucy.*", $options: 'i' }, direction: "egress"}).count();
      var result = await Promise.all([ingressTotal, egressTotal, ingressQuit, egressSaucy]);

      var resultObject = {
        ingressTotal: result[0],
        ingressQuit: result[2],
        ingress: result[0] - result[2],
        egressTotal: result[1],
        egressSaucy: result[3],
        egress: result[1] - result[3]
      };

      console.log(resultObject);
      response.render('counts', {config: request.config, counts: resultObject});  
    } 
    catch (err) {
      console.log(err);
    }
    finally {
      await request.mongoClient.close();
    }
  }

async function getDownloadCsv(request, response) {
  try {
    await request.mongoClient.connect();
    const db = request.mongoClient.db(request.mongoDatabaseName);
    let messagesCollection = db.collection('messages');
    response.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename=download-${Date.now()}.csv`,
      'Transfer-Encoding': 'chunked',
      charset: 'UTF-8'
    });
    messagesCollection
      .find()
      .transformStream({
        transform: ({ _id, createdAt, src, dst, txt, direction, network }) =>
          `${_id},${createdAt},${src},${dst},"${txt}",${direction},${network}\n`
      })
      .pipe(response);
  } catch (err) {
    console.log(err);
    response.sendStatus(500);
  }
  finally {
    await request.mongoClient.close();
  }
}