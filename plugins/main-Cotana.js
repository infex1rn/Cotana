import { persona, formatResponse } from '../lib/responses.js'

let handler = async (m, { conn }) => {
  const logo = './Assets/Cotana-logo.png' 
  
  const text = `
*SOCIAL PROTOCOLS*

Connect with our neural networks and data streams.

✧ GitHub: https://github.com/cotana322
✧ YouTube: https://www.youtube.com/@Aslicotana
✧ Telegram: https://t.me/NAKLI_cotana

Stay synced. ⚡
`.trim()

  await conn.sendMessage(m.chat, {
    image: { url: logo },
    caption: formatResponse(text)
  }, { quoted: m })
  
  m.react('✅')
}

handler.help = ['socials']
handler.tags = ['main']
handler.command = ['groups', 'socials', 'ggp', 'gpcotana']
handler.desc = 'Access the official data streams and social channels of Cotana.'

export default handler
