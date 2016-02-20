var twilio = null;
var http = require('http');
var fs = require('fs');
var express = require('express');
var twilio = require('twilio');
var bodyParser = require('body-parser');
var Promise = require('promise');
var StatefulProcessCommandProxy = require('stateful-process-command-proxy');

var app = express();

app.use(bodyParser.urlencoded({extended: true}));

var keys = fs.readFileSync('./keys.json');
var jsonKeys = JSON.parse(keys);

var client = twilio(jsonKeys.accountSid, jsonKeys.authToken);

var statefulProcessCommandProxy = new StatefulProcessCommandProxy({
  name: 'twilioInstance',
  max: 1,
  min: 1,
  idleTimeoutMS: 10000,
  logFunction: function(severity,origin,msg) {
    //console.log(severity.toUpperCase() + " " +origin+" "+ msg);
  },
  processCommand: '/bin/bash',
  processArgs: ['-s'],
  processRetainMaxCmdHistory: 10,
  processInvalidateOnRegex: {
    'any': [{regex:'.*error.*',flags:'ig'}],
    'stdout': [{regex:'.*error.*',flags:'ig'}],
    'stderr': [{regex:'.*error.*',flags:'ig'}]
  },
  validateFunction: function(processProxy) {
    return processProxy.isValid();
  },
  preDestroyCommands: ['echo This ProcessProxy is being destroyed!']
});

app.post('/twiml', function(req, res) {
  var data = req.body;
  if (twilio.validateExpressRequest(req, jsonKeys.authToken, {url: jsonKeys.twmilUrl})) {
    console.log('Responding to ' + data.From);
    // var resp = new twilio.TwimlResponse();
    // resp.say('Received');
    // res.type('text/xml');
    // res.send(resp.toString());
    if (data.Body == 'shell-quit') {
      statefulProcessCommandProxy.shutdown();
      sendMessage(data.From, data.To, 'SMSTerminal: Shell stopped');
    } else {
      statefulProcessCommandProxy.executeCommand(data.Body).then(function(cmdResult) {
        sendMessage(data.From, data.To, cmdResult.stdout);
      	res.send(null);
      }).catch(function(error) {
        console.log('Error: ' + error);
	  });
    }

  } else {
    console.log('Invalid authentication');
    res.status(403).send('Invalid authentication');
  }
});

function sendMessage(from, to, content) {
  client.messages.create({
    to: from,
    from: to,
    body: content,
  }, function(err, message) {
    console.log('Error executing command: ' + message + err);
    
    if (err != null)
      sendMessage(from, to, 'Invalid command: ' + message);
  });
}

app.get('/', function(req, res) {
  res.send('OK');
});

app.listen(3000, function() {
  console.log('Server is running on port 3000');
});

// setTimeout(function() {
//   statefulProcessCommandProxy.shutdown();
// },10000);
