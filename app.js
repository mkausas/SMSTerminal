var twilio = null;
var http = require('http');
var fs = require('fs');
var express = require('express');
var twilio = require('twilio');
var bodyParser = require('body-parser');
var Promise = require('promise');
var mongoose = require('mongoose');
var StatefulProcessCommandProxy = require('stateful-process-command-proxy');

var Request = require('./request');

var app = express();

app.use(bodyParser.urlencoded({extended: true}));

var keysText = fs.readFileSync('./keys.json');
var keys = JSON.parse(keysText);

var client = twilio(keys.accountSid, keys.authToken);

var mongoURI = keys.databaseUri;
var MongoDB = mongoose.connect(mongoURI).connection;

MongoDB.on('error', function(err) {
  console.log(err.message);
});

MongoDB.once('open', function() {
  console.log('Connected to MongoDB');
});

mongoose.connect(mongoURI);

var resetRequests = function() {
  Request.find({}, function(err, requests) {
    if (!err && requests) {
      requests.forEach(function(request) {
        request.running = false;
        request.save();
      });
    }
  });
};

resetRequests();

var statefulProcessCommandProxy = new StatefulProcessCommandProxy({
  name: 'twilioInstance',
  max: 1,
  min: 1,
  idleTimeoutMS: 90000,
  logFunction: function(severity, origin, msg) {},
  processCommand: '/bin/bash',
  processArgs: ['-s'],
  processRetainMaxCmdHistory: 10,
  processInvalidateOnRegex: {
    'any': [{
      regex: '.*error.*',
      flags: 'ig'
    }],
    'stdout': [{
      regex: '.*error.*',
      flags: 'ig'
    }],
    'stderr': [{
      regex: '.*error.*',
      flags: 'ig'
    }]
  },
  validateFunction: function(processProxy) {
    return processProxy.isValid();
  },
  preDestroyCommands: ['echo This ProcessProxy is being destroyed!']
});

var initTempNumber = function(request) {
  if (request.running) {
    sendMessage(keys.master, keys.user, 'Temporary terminal already running at ' + request.phoneNumber);
  } else {
    request.running = true;
    request.save();
    sendMessage(keys.master, keys.user, 'Temporary terminal created at ' + request.phoneNumber);
    sendMessage(request.phoneNumber, keys.user, 'Welcome to SMSTerminal! Your session will expire in 15 minutes.');
    setTimeout(function() {
      request.running = false;
      request.save();
      statefulProcessCommandProxy.shutdown();
    }, request.timeout);
  }
};

app.post('/twiml', function(req, res) {
  var data = req.body;
  if (twilio.validateExpressRequest(req, keys.authToken, {url: keys.twmilUrl})) {
    if (data.From == keys.user) {
      if (data.To == keys.master) {
        var command = data.Body.toLowerCase();
        if (command == 'shutdown') {
          statefulProcessCommandProxy.shutdown();
          sendMessage(keys.master, keys.user, 'Shell stopped');
        } else if (command == 'request') {
          // If there's at least one temporary phone number in the database, use it instead of creating one
          Request.find({}, function(err, requests) {
            if (!err && requests[0]) {
              initTempNumber(requests[0]);
            } else {
              client.availablePhoneNumbers('US').local.list({}, function(err, numbers) {
                var number = numbers.available_phone_numbers[0].phone_number;
                client.incomingPhoneNumbers.create({phoneNumber: number}, function(err, purchasedNumber) {
                  if (!err && purchasedNumber) {
                    var request = new Request({phoneNumber: number});
                    request.save(function(err) {
                      initTempNumber(request);
                    });
                  } else {
                    sendMessage(keys.master, keys.user, 'Error creating temporary number');
                  }
                });
              });
            }
          });
        } else if (command == '?') {
          sendMessage(keys.master, keys.user,
            'request: Request a new shell session\n'
            + 'shutdown: Stop the existing shell session\n'
            + '?: Display this dialog');
        } else {
          sendMessage(keys.master, keys.user, 'Unknown command');
        }
      } else {
        Request.find({}, function(err, requests) {
          if (!err && requests) {
            var phoneNumberFound = {};
            try {
              requests.forEach(function(request) {
                if (request.phoneNumber == data.To) {
                  statefulProcessCommandProxy.executeCommand(data.Body).then(function(cmdResult) {
                    sendMessage(data.To, keys.user, cmdResult.stdout || '👌');
                  	res.send(null);
                  }).catch(function(error) {
                    console.log('Error: ' + error);
                    sendMessage(data.To, keys.user, 'Error: ' + error);
            	    });
                  throw phoneNumberFound;
                }
                request.save();
              });
            } catch (e) {
              if (e !== phoneNumberFound) {
                throw e;
              }
            }
          }
        });
      }
    } else {
      var failedLoginText = 'Failed login attempt by ' + data.From + ' on number ' + data.To;
      console.log(failedLoginText);
      sendMessage(keys.master, keys.user, failedLoginText);
      sendMessage(data.To, data.From, 'I\'m sorry hackathon hacker, I\'m afraid can\'t let you do that');
    }
  } else {
    console.log('Invalid authentication');
    res.status(403).send('Invalid authentication');
  }
});

var sendMessage = function(sender, receiver, content) {
  client.messages.create({
    to: receiver,
    from: sender,
    body: content,
  }, function(err, message) {
    if (err) {
      console.log('Error executing command: ' + JSON.stringify(err));
    }
  });
};

app.get('/', function(req, res) {
  res.send('OK');
});

app.listen(3000, function() {
  console.log('Server is running on port 3000');
});

// setTimeout(function() {
//   statefulProcessCommandProxy.shutdown();
// },10000);
