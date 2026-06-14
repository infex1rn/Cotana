import { persona, formatResponse } from '../lib/responses.js'
import speed from 'performance-now'

let handler = async (m, { conn }) => {
  let timestamp = speed()
  let pingMsg = await m.reply(formatResponse('⚡ *SPEED PROTOCOLS ACTIVE* ⚡\n\nHold on, darling... checking my neural link... 🌪️'))

  let latency = (speed() - timestamp).toFixed(4)

  await conn.relayMessage(
    m.chat,
    {
      protocolMessage: {
        key: pingMsg.key,
        type: 14,
        editedMessage: {
          conversation: formatResponse(`⚡ *SPEED RESULT* ⚡\n\nToo fast for you? 😈\nLatency: *${latency}* ms 🍭`),
        },
      },
    },
    {}
  )
}

handler.help = ['ping']
handler.tags = ['main']
handler.command = ['ping', 'speed']
handler.desc = 'Check bot response time and server latency'

export default handler
