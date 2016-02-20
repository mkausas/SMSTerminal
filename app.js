var twilio = null;
var http = require('http');
var fs = require('fs');
var express = require('express');
var twilio = require('twilio');
var bodyParser = require('body-parser');

// command line args
var sys = require('util')
var exec = require('child_process').exec;
var child;


var app = express();

app.use(bodyParser.urlencoded({extended: true}));

var keys = fs.readFileSync('./keys.json');
var jsonKeys = JSON.parse(keys);

var client = twilio(jsonKeys.accountSid, jsonKeys.authToken);

app.post('/twiml', function(req, res) {
  var data = req.body;
  if (twilio.validateExpressRequest(req, jsonKeys.authToken, {url: jsonKeys.twmilUrl})) {
    console.log('Responding to ' + data.From);
    // var resp = new twilio.TwimlResponse();
    // resp.say('Received');
    // res.type('text/xml');
    // res.send(resp.toString());
	
	exec(data.Body, function (error, stdout, stderr) {
 		console.log('stdout: ' + stdout);
 		console.log('stderr: ' + stderr);

		client.messages.create({
      		to: data.From,
      		from: data.To,
      		body: stdout,
    	}, function(err, message) {
      		console.log(message.sid);
    	});
    	res.send(null);
 		
 		if (error !== null) {
 			console.log('exec error: ' + error);
 		}
 	});
	
  } else {
    console.log('Invalid authentication');
    res.status(403).send('Invalid authentication');
  }
});

app.get('/', function(req, res) {
  res.send('OK');
});

app.listen(3000, function() {
  console.log('Server is running on port 3000');
});
