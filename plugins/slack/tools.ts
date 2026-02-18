import type { App } from "@slack/bolt";
import type { ToolDefinition } from "../../src/types/message.js";

export function createSlackTools(app: App): ToolDefinition[] {
  return [
    {
      name: "slack_post_message",
      description: "Post a message to a Slack channel",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "The channel ID to post to" },
          text: { type: "string", description: "The message text" },
          thread_ts: { type: "string", description: "Thread timestamp to reply in (optional)" },
        },
        required: ["channel", "text"],
      },
      plugin: "slack",
      handler: async (input) => {
        try {
          await app.client.chat.postMessage({
            channel: input.channel as string,
            text: input.text as string,
            thread_ts: input.thread_ts as string | undefined,
          });
          return { content: `Message posted to ${input.channel}` };
        } catch (err) {
          return { content: `Failed to post message: ${err}`, is_error: true };
        }
      },
    },
    {
      name: "slack_add_reaction",
      description: "Add an emoji reaction to a message",
      input_schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "The channel ID" },
          timestamp: { type: "string", description: "The message timestamp" },
          emoji: { type: "string", description: "Emoji name without colons (e.g. 'thumbsup')" },
        },
        required: ["channel", "timestamp", "emoji"],
      },
      plugin: "slack",
      handler: async (input) => {
        try {
          await app.client.reactions.add({
            channel: input.channel as string,
            timestamp: input.timestamp as string,
            name: input.emoji as string,
          });
          return { content: `Reaction :${input.emoji}: added` };
        } catch (err) {
          return { content: `Failed to add reaction: ${err}`, is_error: true };
        }
      },
    },
  ];
}
