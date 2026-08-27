// discordBot.js — two-way Discord integration.
//
// Outbound (cron notifications — morning briefing, EOD summary, reminders,
// streak warnings): posts via DISCORD_WEBHOOK_URL. Independent of the gateway
// bot's login state — works even if the bot below never connects.
//
// Inbound (chat): the gateway bot (DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID)
// listens for messages in that one channel and runs them through the exact
// same chat pipeline as the web app (chatHandler.js) — message the bot like
// you'd use the web chat.
//
// Both DISCORD_BOT_TOKEN and DISCORD_WEBHOOK_URL are optional and independent
// — either, both, or neither can be configured.

import { Client, GatewayIntentBits } from 'discord.js'
import { handleChatMessage } from './chatHandler.js'

const DISCORD_SESSION_KEY = 'discord_chat'

// ── Outbound — webhook ─────────────────────────────────────────────────────────
export async function postToDiscord(message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!webhookUrl) return

  try {
    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content: message })
    })
    if (!res.ok) console.error(`[discord] webhook failed: ${res.status} ${res.statusText}`)
  } catch (err) {
    console.error('[discord] webhook error:', err.message)
  }
}

// ── Inbound — gateway bot ──────────────────────────────────────────────────────
export function initDiscordBot() {
  const token     = process.env.DISCORD_BOT_TOKEN
  const channelId = process.env.DISCORD_CHANNEL_ID

  if (!token || !channelId) {
    console.log('[discord] DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set — inbound chat disabled')
    return
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  // discord.js v14.26 emits 'clientReady' — 'ready' is deprecated and never
  // fires on this version.
  client.once('clientReady', (readyClient) => {
    console.log(`[discord] Connected: ${readyClient.user.tag} — watching channel ${channelId}`)
  })

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return
    if (message.channel.id !== channelId) return

    const userText = message.content.trim()
    if (!userText) return

    await message.channel.sendTyping().catch(() => {})

    try {
      const { reply } = await handleChatMessage(userText, DISCORD_SESSION_KEY)
      await message.reply(reply || 'Done.')
    } catch (err) {
      console.error('[discord] chat error:', err.message)
      await message.reply(`⚠ Error: ${err.message}`).catch(() => {})
    }
  })

  client.login(token).catch(err => {
    console.error('[discord] Login failed:', err.message)
  })
}
