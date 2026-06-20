import fs from 'fs'
import os from 'os'
import { downloadYouTubeAudio } from '../lib/youtube-downloader.js'

const tmpDir = os.tmpdir()

let handler = async (m, { conn, args, usedPrefix, command }) => {
  if (!args || !args[0]) throw `✳️ Example :\n${usedPrefix + command} https://youtu.be/YzkTFFwxtXI`
  if (!args[0].match(/youtu/gi)) throw `❎ Verify that it is a YouTube link.`
  
  try {
    await m.reply('⏳ Processing your request, please wait...');
    
    const audio = await downloadYouTubeAudio(args[0], tmpDir)
    
    const message = {
      audio: { url: audio.filePath },
      mimetype: audio.mimetype,
      fileName: audio.fileName,
      ptt: false
    };
    
    await conn.sendMessage(m.chat, message, { quoted: m });
    
    // Cleanup
    setTimeout(() => {
      if (fs.existsSync(audio.filePath)) fs.unlinkSync(audio.filePath)
    }, 10000)
    
  } catch (error) {
    console.error('Error in YouTube audio download:', error);
    await m.reply(`❎ Error: Could not download the audio. ${error.message}`);
  }
}

handler.help = ['ytmp3 <url>']
handler.tags = ['downloader']
handler.command = ['ytmp3', 'yta']
handler.desc = 'Download YouTube audio using a URL'

export default handler
