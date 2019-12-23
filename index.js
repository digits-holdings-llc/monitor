const express = require('express');
const app = express();
const http = require('http').createServer(app);

const port = process.env.WEB_PORT || 80;
const { GraphQLClient } = require('graphql-request');
const SUBDOMAIN = process.env.SUBDOMAIN;
const MONGO_CLUSTER_URL = process.env.MONGO_CLUSTER_URL;
const MONGO_URL = `${MONGO_CLUSTER_URL}/${SUBDOMAIN}/?retryWrites=true&w=majority` || `mongodb://localhost:27017/${SUBDOMAIN}`;
const { init, log, client } = require('greenbot-sdk');
const serveIndex = require('serve-index');
const shell = require('shelljs');

// Parse JSON bodies (as sent by API clients)
app.use(express.json());
app.use(express.urlencoded());
app.engine('pug', require('pug').__express);
app.set('view engine', 'pug');
app.set('views', './views');
app.use(express.static('public'));
init(app, http);

function getCsvExportCommandText() {
  const filename = 'download-' + Date.now() + '.csv';
  return {
    commandLine: ['mongoexport', '--uri="' + MONGO_URL + '"', '--fields=_id,createdAt,src,dst,txt,direction,network', '--collection=messages', '--type=csv', '--out=exports/' + filename].join(' '),
    filename: filename
  };
}

async function getCsvExportCommand(commandLine) {
  const result = await shell.exec(commandLine);
  console.log(result.code);
  if (result.code !== 0) {
    throw 'CSV export command failed with code: ' + result.code;
  }
}

app.get('/', async function(request, response) {
  await getMessages(request, response);
});

async function saveMessage(message) {
  try {
    const db = client.db(SUBDOMAIN);
    let messagesCollection = db.collection('messages');
    await messagesCollection.insertOne(message);
  } catch (err) {
    log(err);
  }
}

async function getMessages(request, response) {
  try {
    const db = client.db(SUBDOMAIN);
    const respColl = db.collection('messages');
    const responses = await respColl.find({}, { sort: { createdAt: -1 }, limit: 10 }).toArray();
    response.render('index', { responses, config: request.config });
  } catch (err) {
    log(err);
  }
}

async function getDownloadCsv(request, response) {
  const file = getCsvExportCommandText();
  console.log(file.commandLine);
  console.log(file.filename);

  try {
    await getCsvExportCommand(file.commandLine);
    response.redirect('/exports/' + file.filename);
  } catch (err) {
    log(err);
    response.sendStatus(500);
  }
}

app.get('/download.csv', async function(request, response) {
  await getDownloadCsv(request, response);
});

// Access the parse results as request.body
app.post('/', async function(request, response) {
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
  log('New message : ', direction, ':', inboundMsg.msg.src, '->', inboundMsg.msg.dst, ':', inboundMsg.msg.txt);
  await saveMessage(inboundMsg.msg);
  response.send({});
});

app.use('/exports', express.static('exports'), serveIndex('exports', { icons: true }));
http.listen(port, () => log(`Automation running on ${port}!`));
