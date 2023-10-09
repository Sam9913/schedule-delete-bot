import "dotenv/config";
import express from "express";
import { InteractionType, InteractionResponseType } from "discord-interactions";
import { VerifyDiscordRequest, DiscordRequest } from "./utils.js";
import { ApiRequest } from "./utils.js";

// Create an express app
const app = express();
// Get port, or default to 3000
const PORT = process.env.PORT || 3000;
// Parse request body and verifies incoming requests using discord-interactions package
app.use(express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }));

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 */
app.post("/interactions", async function (req, res) {
  // Interaction type and data
  const { type, data, channel_id } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;
    
    if (name === "check_cron") {
      var result = false;

      try {
        const rawResult = await ApiRequest('checkCron', {channel_id});

        const jsonResult = await rawResult.json();
        result = jsonResult.isWorking;
      } catch (err) {
        console.error("Error checkCron:", err);
      } 

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: !result ? "No cron job wor" : "Got cron job working",
        },
      });
    }

    if (name === "cron_start") {
      await res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content:
            "Cron job starting, if not deleted means cron job cannot start",
        },
      });

      var result = false;

      try {
        const rawResult = await ApiRequest('startCron', {channel_id});

        const jsonResult = await rawResult.json();
        result = jsonResult.isSuccess;
      } catch (err) {
        console.error("Error startCron:", err);
      } finally {
        if (result) {
          const getEndpoint = `channels/${channel_id}/messages?limit=1`;
          const deleteEndpoint = `channels/${channel_id}/messages`;

          try {
            const msgRes = await DiscordRequest(getEndpoint, {
              method: "GET",
            });
            const jsonMsgList = await msgRes.json();

            await DiscordRequest(deleteEndpoint + `/${jsonMsgList[0].id}`, {
              method: "DELETE",
            });
          } catch (err) {
            console.error("Error get and delete command message:", err);
          }
        }
      }
    }

    if (name === "cron_end") {
      var result = false;

      try {
        const rawResult = await ApiRequest('endCron', {channel_id});

        const jsonResult = await rawResult.json();
        result = jsonResult.isSuccess;
      } catch (err) {
        console.error("Error stopCron:", err);
      } 

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: !result ? "Nothing to stop" : "Cron job stoped",
        },
      });
    }
  }
});

app.listen(PORT, () => {
  console.log("Listening on port", PORT);
});

app.get("/", function (req, res) {
  res.send("Halo there");
});
