import { persona, formatResponse } from '../lib/responses.js'

let handler = async (m, { conn, text, usedPrefix, command }) => {
  let name = m.pushName || conn.getName(m.sender)
  var vn = 'https://cdn.jsdelivr.net/gh/cotana322/cotana-BOT@main/Assets/mp3/Alive.mp3'
  let img = './Assets/Cotana.png'
  
  let str = `Hii ${name}! 💋 Did you miss me? \n\nI'm alive and extra nutty today! 😈✨ Don't keep me waiting too long or I might get into trouble... 🌪️🍭`

  await conn.sendMessage(m.chat, {
    audio: { url: vn },
    mimetype: 'audio/mpeg',
    ptt: true,
    fileName: 'cotana',
    contextInfo: {
      mentionedJid: [m.sender],
      externalAdReply: {
        title: '✨ COTANA IS HERE ✨',
        body: 'Feeling nutty and naughty! 😈',
        thumbnailUrl: img,
        sourceUrl: 'https://github.com/cotana322/cotana-BOT',
        mediaType: 1,
        renderLargerThumbnail: true,
      },
    },
  }, { quoted: m })
  
  await m.reply(formatResponse(str))
}

handler.help = ['alive']
handler.tags = ['main']
handler.command = /^(alive)$/i
handler.desc = 'Check if the bot is alive'

export default handler
