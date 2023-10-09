require('dotenv').config()
//mongodb
const PASSWORD = process.env.PASSWORD
const USERNAME = process.env.USERNAME
const DBNAME = process.env.DBNAME
//discord
const TOKEN = process.env.TOKEN

const axios = require('axios')
const express = require('express')
const app = express()
// Parse JSON bodies
app.use(express.json())

const { MongoClient, ServerApiVersion } = require('mongodb');
const mongoUri = `mongodb+srv://${USERNAME}:${PASSWORD}@cluster0.qlymm.mongodb.net/?retryWrites=true&w=majority`;

const mongoClient = new MongoClient(mongoUri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const discord_api = axios.create({
    baseURL: 'https://discord.com/api',
    timeout: 3000,
    headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
        "Access-Control-Allow-Headers": "Authorization",
        "Authorization": `Bot ${TOKEN}`
    }
});

app.all('/', async (req, res) => {
    console.log("Just got a request!")
    res.send('Yo!')
})

app.post('/startCron', async (req, res) => {
    var channel_id = req.body.channel_id;

    try {
        await mongoClient.connect();

        await mongoClient.db(DBNAME).command({ ping: 1 });
        const guild = mongoClient.db(DBNAME).collection("Guild");
        const message = mongoClient.db(DBNAME).collection("Message");

        await guild.updateOne({ channel_id: channel_id }, { $set: { cron_status: 1 } }, { upsert: true });

        let msgObjList = [];
        let getBulkEndpoint = `/channels/${channel_id}/messages?limit=100`;
        let lastMessageId = null;
        do {
            if (lastMessageId !== null) {
                getBulkEndpoint = `/channels/${channel_id}/messages?limit=100&before=${lastMessageId}`;
            }

            try {
                const msgRes = await discord_api.get(getBulkEndpoint);
                const messageList = msgRes.data;

                for (let i = 0; i < messageList.length; i++) {
                    msgObjList.push({
                        message_id: messageList[i].id,
                        timestamp: new Date(messageList[i].timestamp),
                        channel_id: channel_id,
                    });
                }

                if (messageList.length === 100) {
                    lastMessageId = messageList[messageList.length - 1].id;
                } else {
                    lastMessageId = null;
                }
            } catch (e) {
                return res.status(500).send({ error: `An error occurred on ${getBulkEndpoint}`, details: e.message });
            }
        } while (lastMessageId !== null)

        if (msgObjList.length > 0) {
            await message.insertMany(msgObjList);
        }

    } catch (e) {
        return res.send({ isSuccess: false, details: e.message });
    } finally {
        await mongoClient.close();
        return res.send({ isSuccess: true });
    }

});

app.post('/endCron', async (req, res) => {
    var channel_id = req.body.channel_id;

    try {
        await mongoClient.connect();

        const guild = mongoClient.db(DBNAME).collection("Guild");

        const existServer = await guild.findOne({ channel_id: channel_id });

        if (existServer !== null) {
            await guild.updateOne({ channel_id: channel_id }, { $set: { cron_status: 0 } });
            return res.send({ isSuccess: true });
        } else {
            return res.send({ isSuccess: false });
        }
    } finally {
        await mongoClient.close();
    }
});

app.post('/checkCron', async (req, res) => {
    var channel_id = req.body.channel_id;
    let isWorking = false;

    try {
        await mongoClient.connect();

        const guild = mongoClient.db(DBNAME).collection("Guild");

        const existServer = await guild.findOne({ channel_id: channel_id });

        if (existServer !== null) {
            isWorking = existServer.cron_status == 0 ? false : true;
        }
    } finally {
        await mongoClient.close();
        return res.send({ isWorking: isWorking });
    }

});

app.post('/getMessage', async (req, res) => {
    let msgObjList = [];

    try {
        await mongoClient.connect();

        const guild = mongoClient.db(DBNAME).collection("Guild");
        const message = mongoClient.db(DBNAME).collection("Message");

        const activeServers = await guild.find({ cron_status: 1 });

        for await (const activeServer of activeServers) {
            const channelId = activeServer.channel_id;

            let getBulkEndpoint = `/channels/${channelId}/messages?limit=100`;
            const lastMessage = await message.findOne({ channel_id: channelId }, { sort: { timestamp: -1 } });
            if (lastMessage !== null) {
                getBulkEndpoint = `${getBulkEndpoint}&after=${lastMessage.message_id}`;
            }

            try {
                const msgRes = await discord_api.get(getBulkEndpoint);
                const messageList = msgRes.data;
        
                for (let i = 0; i < messageList.length; i++) {
                    msgObjList.push({
                        message_id: messageList[i].id,
                        timestamp: new Date(messageList[i].timestamp),
                        channel_id: channelId,
                    });
                }
            } catch (e) {
                return res.status(500).send({ error: `An error occurred on ${getBulkEndpoint}`, details: e.message });
            }
        }

        if (msgObjList.length > 0) {
            await message.insertMany(msgObjList);
        }
    } catch (e) {
        return res.send({ isSuccess: false, details: e.message });
    } finally {
        await mongoClient.close();
        return res.send({ isSuccess: true });
    }

});


app.post('/deleteMessage', async (req, res) => {
    let msgIds = [];
    var channel_id;

    try {
        await mongoClient.connect();

        const guild = mongoClient.db(DBNAME).collection("Guild");
        const message = mongoClient.db(DBNAME).collection("Message");
        const activeServers = await guild.find({ cron_status: 1 });

        for await (const activeServer of activeServers) {
            if (activeServer !== null) {
                channel_id = activeServer.channel_id;
    
                const findResult = await message.find({ channel_id: channel_id, timestamp: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } });
                for await (const element of findResult) {
                    if (msgIds.length < 100) {
                        msgIds.push(element.message_id);
                    }
                }
    
                if (msgIds.length > 0) {
                    let canRemove = false;
                    if (msgIds.length >= 2) {
                        try {
                            await discord_api.post(`/channels/${channel_id}/messages/bulk-delete`, { messages: msgIds });
                        } catch (e) {
                            return res.status(500).send({ error: `An error occurred on deleteBulkMessage`, details: e.message });
                        } finally {
                            canRemove = true;
                        }
                    } else if (msgIds.length > 0) {
                        try {
                            await discord_api.delete(`/channels/${channel_id}/messages/${msgIds[0]}`);
                        } catch (e) {
                            return res.status(500).send({ error: `An error occurred on deleteMessage`, details: e.message });
                        } finally {
                            canRemove = true;
                        }
                    }
    
                    if (canRemove) {
                        await message.deleteMany({ message_id: { $in: msgIds } });
                    }
                }
            }
        }
    } catch (e) {
        return res.send({ isSuccess: false, details: e.message });
    } finally {
        await mongoClient.close();
        return res.send({ isSuccess: true });
    }

});

app.listen(process.env.PORT || 3000)