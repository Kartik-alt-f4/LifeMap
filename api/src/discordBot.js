// discordBot.js — Discord gateway (inbound) + webhook (outbound)
// Structure kept from v1. Rewired to new agent pipeline.

import { Client, GatewayIntentBits } from 'discord.js'
import { runAgent }       from './agentPipeline.js'
import { getHistory, saveExchange, formatForGemini } from './sessionManager.js'
import { getPlayerState } from './dbAgent.js'
import { executeActions } from './actionExecutor.js'

// ── Outbound webhook ──────────────────────────────────────────────────────────
export async function postToDiscord(message) {
  if (!process.env.DISCORD_WEBHOOK_URL) return
  try {
    const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    })
    if (!res.ok) console.error(`Discord webhook failed: ${res.status}`)
  } catch (err) {
    console.error('Discord webhook error:', err.message)
  }
}

// ── Inbound gateway bot ───────────────────────────────────────────────────────
export function initDiscordBot() {
  const token     = process.env.DISCORD_BOT_TOKEN
  const channelId = process.env.DISCORD_CHANNEL_ID

  if (!token || !channelId) {
    console.log('Discord bot credentials missing — skipping')
    return
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  })

  client.on('clientReady', (c) => {
    console.log(`▶ Discord bot active: ${c.user.tag}`)
    console.log(`▶ Monitoring channel: ${channelId}`)
  })

  client.on('messageCreate', async (message) => {
    if (message.author.bot)              return
    if (message.channel.id !== channelId) return
    const text = message.content.trim()
    if (!text) return

    await message.channel.sendTyping()

    try {
      const SESSION_KEY  = 'discord'
      const today        = new Date().toISOString().split('T')[0]
      const { sessionId, messages } = await getHistory(SESSION_KEY)
      const history      = formatForGemini(messages)
      const playerState  = await getPlayerState()

      const { reply, actions, needsClarification, clarificationQuestion } =
        await runAgent(text, history, playerState, today)

      // Execute actions server-side
      if (actions.length && !needsClarification) {
        await executeActions(actions, playerState)
      }

      const finalReply = needsClarification ? clarificationQuestion : reply
      await saveExchange(sessionId, text, finalReply)
      await message.reply(finalReply)

    } catch (err) {
      console.error('Discord processing error:', err.message)
      await message.reply(`⚠ Error: ${err.message}`)
    }
  })

  client.login(token)
}
