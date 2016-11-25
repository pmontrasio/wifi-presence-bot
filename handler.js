'use strict';

const secrets = require('./secrets.json')

const TELEGRAM_API_HOST = "api.telegram.org";
const TELEGRAM_API_URL = escape("/bot" + secrets.telegramToken);

const ALARM_THRESHOLD = 10;

const https = require('https');
var AWS = require("aws-sdk");

var docClient = new AWS.DynamoDB.DocumentClient();

module.exports.setDocClient = (otherDocClient) => {
  docClient = otherDocClient;
}


/*
curl -X POST https://XXXXXXXX.execute-api.eu-west-1.amazonaws.com/dev/presenceAlertWebhook
  with a https://core.telegram.org/bots/api#message

or this event for testing

{
body: {
  update_id: 455422569,
  message: { message_id: 83, from: [Object], chat: [Object], date: 1476266846, text: 'hi' }
},
method: 'POST', principalId: '', stage: 'dev',
headers: { ... },
query: {}, path: {}, identity: { ... }, stageVariables: {}
}

*/
module.exports.presenceAlertWebhook = (event, context, callback) => {
  //console.log(JSON.stringify(event, null, 2));
  const message = event.body.message;
  if (!message) {
    return callback(null, {});
  }

  // never trust the input
  const userId = parseInt(escape(message.from.id));
  const userName = escape(message.from.first_name);
  const chatId = parseInt(escape(message.chat.id));

  let responseMessage = null;
  if (message.entities) {
    message.entities.forEach((entity) => {
      if (entity.type != "bot_command") {
        return;
      }
      const command = message.text.substr(entity.offset, entity.length);
      if (command === "/start") {
        addUser(userId, chatId);
        responseMessage = "Added";
      } else if (command === "/stop") {
        deleteUser(userId);
        responseMessage = "Removed";
      }
    });
  }
  if (!responseMessage) {
    responseMessage = firstTimeHelp(userName);
  }

  sendMessage(chatId, responseMessage);
  callback(null, {});
};

/*
DynamoDB trigger.

A trigger event is like this:

{
  Records: [
  {
    eventID: 'b1f8a36542fbfbc1285d18db1feca90f',
    eventName: 'INSERT',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'eu-west-1',
    dynamodb: [Object],
    eventSourceARN: 'arn:aws:dynamodb:eu-west-1:XXXXXXXX:table/Presences/stream/2016-10-11T14:03:05.258'
  }
  ]
}
*/
module.exports.presenceNotifier = (event, context, callback) => {
  event.Records.forEach((trigger) => {
    //console.log(JSON.stringify(trigger, null, 2));
    if (trigger.eventSource === "aws:dynamodb" && trigger.eventName === "INSERT") {
      // The trigger.dynamodb object is like this
      // { ApproximateCreationDateTime: 1476198840, Keys: { timestamp: { N: '1475929090' } }, NewImage: { presences: { N: '13' }, timestamp: { N: '1475929090' } }, SequenceNumber: '4867600000000000671381154', SizeBytes: 41, StreamViewType: 'NEW_AND_OLD_IMAGES' }
      const presences = parseInt(trigger.dynamodb.NewImage.presences.N);
      if (presences >= ALARM_THRESHOLD) {
        const timestamp = parseInt(trigger.dynamodb.NewImage.timestamp.N);
        sendMessageToAllUsers(timestamp, presences);
      }
    }
  });
  // How to know that all messages have been sent and we can terminate the lambda?
  // By default callback() doesn't freeze the process if the event loop is not empty.
  // See http://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
  callback(null, {});
};


// Telegram API

function sendMessage(chatId, text) {
  //console.log("sendMessage(" + chatId + ", " + text + ")");
  const post_data = JSON.stringify({
    "chat_id": chatId,
    "text": text
  });
  //console.log("post_data", post_data);

  const post_options = {
    host: TELEGRAM_API_HOST,
    port: 443,
    path: TELEGRAM_API_URL + "/sendMessage",
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(post_data)
    }
  };

  //console.log("Telegram API call:", JSON.stringify(post_options, null, 2));
  const request = https.request(post_options, (response) => {
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      //console.log("Telegram response:", JSON.stringify(chunk, null, 2));
    })
  });

  request.write(post_data);
  request.end();

};

// UI messages

function firstTimeHelp(userName) {
  return "Hi " + userName + "! You can use\n/start to receive alerts\n/stop to stop receiving them";
}

function sendMessageToAllUsers(timestamp, presences) {
  const message = "There are " + presences + " presences on " + formattedDatetime(timestamp);
  const users = getAllUsers((users) => {
    //console.log("getAllUsers", JSON.stringify(users, null, 2));
    users.Items.forEach((user) => {
      sendMessage(user["chatId"], message);
    });
  });
}

function formattedDatetime(timestamp) {
  const date = new Date(timestamp * 1000);
  const year = 1900 + date.getYear();
  let month = 1 + date.getMonth();
  let day = date.getDate();
  let hours = date.getHours();
  let minutes = date.getMinutes();
  if (month < 10) { month = "0" + month; }
  if (day < 10) { day = "0" + day; }
  if (hours < 10) { hours = "0" + hours; }
  if (minutes < 10) { minutes = "0" + minutes; }
  return year + "/" + month + "/" + day + " " + hours + ":" + minutes;
}

// User persistence

function getAllUsers(callback) {
  const params = { TableName: "Users" };
  docClient.scan(params, (err, users) => {
    if (err) {
      //console.log("getAllUsers failed:", JSON.stringify(err, null, 2));
    } else {
      callback(users);
      // the argument of the callback is something like
      // { "Items": [ { "chatId": <number>, "userId": <number> } ], "Count": 1, "ScannedCount": 1 }
    }
  });
}

function addUser(userId, chatId) {
  const params = { TableName: "Users",
                   Item: { "userId": userId, "chatId": chatId } };
  docClient.put(params, (err, data) => {
    if (err) {
      //console.log("addUser failed:", JSON.stringify(err, null, 2));
    }
  });
}

function deleteUser(userId) {
  const params = { TableName: "Users", Key: { "userId": userId } };
  docClient.delete(params, (err, data) => {
    if (err) {
      //console.log("deleteUser failed:", JSON.stringify(err, null, 2));
    }
  });
}
