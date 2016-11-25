# Setup

Copy the .env file from the receiver directory to here

```
serverless create --template aws-nodejs --name presence-bot
```
...

# Input

Telegram gets commands from the users from the webhook.

Possible entry points:

* update_id, integer
* message, https://core.telegram.org/bots/api#message
** message.user.id is the unique identifier of the user
* edited_message, https://core.telegram.org/bots/api#message
** edited_message.user.id is the unique identifier of the user
* inline_query, https://core.telegram.org/bots/api#inlinequery
** inline_query.from.id is the unique identifier of the user
* chosen_inline_result, https://core.telegram.org/bots/api#choseninlineresult
** chosen_inline_result.from.id is the unique identifier of the user
* callback_query, https://core.telegram.org/bots/api#callbackquery
** callback_query.from.id is the unique identifier of the user

DynamoDB sends new presence data to the bot by using triggers on a stream.

Serverless *doesn't create*  the stream for us.

Go to the AWS Console: DynamoDB, Table, select the Presences table, click the Overview tab, click on Manage Stream in Stream details. Accept the default and click Enable. Copy the Latest stream ARN to ```serverless.yml``` to the ```stream``` declaration at the end of the ```functions``` section:

 According to the documentation It creates the trigger, by hooking up the stream with our lambda function. So it's not fully automatic this time. Big disappointment. Actually I had to create the trigger myself.

Go to the AWS Console: DynamoDB, Table, select the Presences table, click the Triggers tab, click on Create Trigger, Existing Lambda function. Select ```presence-bot-dev-presenceNotifier```. Click Create.

```
functions:
  presenceAlertWebhook:
    ...
  presenceNotifier:
    handler: handler.presenceNotifier
    events:
    - stream: arn:aws:dynamodb:eu-west-1:XXXXXXXX:table/Presences/stream/yyyy-mm-ddTHH:MM:SS.sss
```

Run ```serverless deploy``` and notice that the presenceNotifier function doesn't have a HTTP endpoint.

# Output

The bot sends messages back to users using the ```sendMessage``` API method documented at https://core.telegram.org/bots/api#sendmessage

It calls the API at the end of the ```presenceAlertWebhook```


# Deployment

```
serverless deploy
```

Note the URL returned by the deploy command. You have to use it to register the webhook at Telegram.

```
curl -X POST https://api.telegram.org/bot<access token>/setWebhook -d url=<lambda-url>
```

# Bot UI

The bot responds to two commands

* ```/start``` to add the user to the notification list
* ```/stop``` to remove the user from the list

Any other message will return the help text.

When the ```countersReceiver``` function writes a value of ```presences``` larger than the alarm threshold (it's 10, check ```handler.js```), the users on the notification list get a message with the alarm. Example: "There are 39 presences on 2016/10/08 15:07"
