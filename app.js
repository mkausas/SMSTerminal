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
var User = require('./user');

var app = express();

app.use(bodyParser.urlencoded({extended: true}));

var keysText = fs.readFileSync('./keys.json');
var keys = JSON.parse(keysText);

var client = twilio(keys.accountSid, keys.authToken);

var mongoURI = keys.databaseUri;
var MongoDB = mongoose.connect(mongoURI).connection;

var ok = '👌';

MongoDB.on('error', function(err) {
  console.log(err.message);
});

MongoDB.once('open', function() {
  console.log('Connected to MongoDB');
});

mongoose.connect(mongoURI);

var currentEpochTime = function() {
  return Math.round(new Date().getTime() / 1000);
};

var resetDatabase = function() {
  Request.find({}, function(err, requests) {
    if (!err && requests) {
      requests.forEach(function(request) {
        if (request.running) {
          request.running = false;
          request.updatedAt = currentEpochTime();
          request.save();
        }
      });
    }
  });
  User.find({}, function(err, users) {
    if (!err && users) {
      users.forEach(function(user) {
        if (user.hasAccess) {
          user.hasAccess = false;
          user.updatedAt = currentEpochTime();
          user.save();
        }
      });
    }
  });
};

resetDatabase();

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
    request.updatedAt = currentEpochTime();
    request.save();
    sendMessage(keys.master, keys.user, request.phoneNumber);
    sendMessage(request.phoneNumber, keys.user, 'Welcome to SMSTerminal! Your session will expire in ' + (request.timeout / 60000) + ' minutes.');
    setTimeout(function() {
      resetDatabase();
      statefulProcessCommandProxy.shutdown();
    }, request.timeout);
  }
};

var getCurrentSessionNumber = function(callback) {
  Request.find({}, function(err, requests) {
    if (!err && requests) {
      var phoneNumberFound = {};
      var phoneNumber = '';
      try {
        requests.forEach(function(request) {
          if (request.running) {
            phoneNumber = request.phoneNumber;
            throw phoneNumberFound;
          }
        });
      } catch (e) {
        if (e !== phoneNumberFound) {
          throw e;
        }
      }
      callback(null, phoneNumber);
    } else {
      callback('error', null);
    }
  });
}

app.post('/twiml', function(req, res) {
  var data = req.body;
  if (twilio.validateExpressRequest(req, keys.authToken, {url: keys.twmilUrl})) {
    var runInShell = function() {
      getCurrentSessionNumber(function(err, phoneNumber) {
        if (!err && phoneNumber) {
          if (phoneNumber == data.To) {

            var broadcastMessage = function(cmd, msg) {
              User.find({hasAccess: true}, function(err, users) {
                if (!err && users) {
                  users.forEach(function(user) {
                    if (user.phoneNumber != data.From) {
                      sendMessage(data.To, user.phoneNumber, data.From + ': ' + cmd + '\n\n' + (msg || ok));
                    } else {
                      sendMessage(data.To, user.phoneNumber, msg || ok);
                    }
                  });
                }
              });
              if (data.From != keys.user) {
                sendMessage(data.To, keys.user, data.From + ': ' + cmd + '\n\n' + (msg || ok));
              } else {
                sendMessage(data.To, keys.user, msg || ok);
              }
            };

            statefulProcessCommandProxy.executeCommand(data.Body).then(function(cmdResult) {
              broadcastMessage(data.Body, cmdResult.stdout);
              res.send(null);
            }).catch(function(error) {
              console.log('Error: ' + error);
              broadcastMessage(data.Body, 'Error: ' + error);
            });
          }
        } else {
          sendMessage(data.To, keys.user, 'Error: Session not running');
        }
      });
    };

    if (data.From == keys.user && data.To == keys.master) {

        var requestCommand = function(time) {
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
                    if (time) {
                      request.timeout = time;
                    }
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
        };

        var command = data.Body.toLowerCase();
        if (command == 'shutdown') {
          resetDatabase();
          statefulProcessCommandProxy.shutdown();
          sendMessage(keys.master, keys.user, ok);
        } else if (command == 'request') {
          requestCommand(null);
        } else if (command == '?') {
          sendMessage(keys.master, keys.user,
            'request: Request a 15 minute shell session\n'
            + 'request 30: Request a 30 minute shell session (max 120 minutes)\n'
            + 'add +10005553333: Add number 000-555-3333 to shell session\n'
            + 'shutdown: Stop the existing shell session\n'
            + '?: Display this dialog');
        } else if (command.indexOf(' ') != -1) {
          var pos = command.indexOf(' ');
          var params = command.substring(pos + 1);
          command = command.substring(0, pos);
          if (command == 'request' && params) {
            var minutes = Integer.parseInt(params);
            if (0 < minutes && minutes <= 120) {
              requestCommand(minutes * 60000);
            } else {
              sendMessage(keys.master, keys.user, 'Error: Minutes must be between 1 and 120');
            }
          } else if (command == 'add' && params) {
            getCurrentSessionNumber(function(err, phoneNumber) {
              if (!err && phoneNumber) {
                User.findOne({phoneNumber: params}, function(err, user) {
                  if (!err && user) {
                    if (!user.hasAccess) {
                      user.hasAccess = true;
                      user.updatedAt = currentEpochTime();
                      user.save();
                    }
                  } else {
                    var user = new User({phoneNumber: params});
                    user.save();
                  }
                  sendMessage(keys.master, keys.user, ok);
                  sendMessage(phoneNumber, params, 'You\'ve been added to a terminal session by ' + keys.user);
                });
              } else {
                sendMessage(keys.master, keys.user, 'Error: Session not running');
              }
            });
          } else {
            sendMessage(keys.master, keys.user, 'Error: Unknown command');
          }
        } else {
          sendMessage(keys.master, keys.user, 'Error: Unknown command');
        }
    } else if (data.From == keys.user) {
      runInShell();
    } else {
      User.findOne({phoneNumber: data.From}, function(err, user) {
        if (!err && user && user.hasAccess) {
          runInShell();
        } else {
          var failedLoginText = 'Failed login attempt by ' + data.From + ' on number ' + data.To;
          console.log(failedLoginText);
          sendMessage(keys.master, keys.user, failedLoginText);
          sendMessage(data.To, data.From, 'I\'m sorry hackathon hacker, I\'m afraid can\'t let you do that');
        }
      });
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
  res.send(ok);
});

app.listen(3000, function() {
  console.log('Server is running on port 3000');
});
