// api/src/discordBot.js — replace with this version
// Discord is optional — if DISCORD_TOKEN or DISCORD_CHANNEL_ID is missing,
// all calls silently no-op. Friends without Discord still get push notifications.

import { Client, GatewayIntentBits } from 'discord.js'

let client  = null
let channel = null
let ready   = false

const DISCORD_ENABLED = !!(process.env.DISCORD_TOKEN && process.env.DISCORD_CHANNEL_ID)

export function initDiscordBot() {
  if (!DISCORD_ENABLED) {
    console.log('[discord] Disabled — DISCORD_TOKEN or DISCORD_CHANNEL_ID not set')
    return
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] })

  client.once('ready', async () => {
    try {
      channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID)
      ready   = true
      console.log('[discord] Connected:', client.user.tag)
    } catch (e) {
      console.error('[discord] Channel fetch failed:', e.message)
    }
  })

  client.login(process.env.DISCORD_TOKEN).catch(e => {
    console.error('[discord] Login failed:', e.message)
  })
}

export async function postToDiscord(message) {
  if (!DISCORD_ENABLED || !ready || !channel) return
  try {
    await channel.send(message)
  } catch (e) {
    console.error('[discord] Send failed:', e.message)
  }
}