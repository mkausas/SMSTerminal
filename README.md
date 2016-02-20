## Setup

Install ngrok
`brew install ngrok` OR https://ngrok.com/download

Run ngrok
`ngrok http 3000`

Go to URL https://www.twilio.com/user/account/voice/dev-tools/twiml-apps/add and set Messaging Request URL to https://DOMAIN-CODE.ngrok.io/twmil

Go to URL https://www.twilio.com/user/account/phone-numbers/incoming, then select phone number, configure messaging with TwiML app, and set to recently created TwiML app

Create `./keys.json` with live account sid and live auth token from https://www.twilio.com/user/account/settings
```
{
  "accountSid": "LIVE_ACCOUNT_SID",
  "authToken": "LIVE_AUTH_TOKEN",
  "twmilUrl": "https://DOMAIN-CODE.ngrok.io/twmil",
  "databaseUri": "mongodb://localhost:27017/test_db_name",
  "master": "+1masterPhoneNumber",
  "user": "+1userPhoneNumber"
}
```

Install node modules
`npm install`

Start server
`node app`
