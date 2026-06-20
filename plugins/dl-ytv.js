import fs from 'fs'
import os from 'os'
import { downloadYouTubeVideo } from '../lib/youtube-downloader.js'

const tmpDir = os.tmpdir()

let handler = async (m, { conn, args, usedPrefix, command }) => {
  if (!args || !args[0]) throw `✳️ Example :\n${usedPrefix + command} https://youtu.be/YzkTFFwxtXI`
  if (!args[0].match(/youtu/gi)) throw `❎ Verify that it is a YouTube link.`
  
  try {
    await m.reply('⏳ Processing your request, please wait...');
    
    const video = await downloadYouTubeVideo(args[0], tmpDir)
    
    await conn.sendFile(m.chat, video.filePath, video.fileName, '', m, false, { mimetype: video.mimetype });
    
    // Cleanup
    setTimeout(() => {
      if (fs.existsSync(video.filePath)) fs.unlinkSync(video.filePath)
    }, 10000)
    
  } catch (error) {
    console.error('Error in YouTube video download:', error);
    await m.reply(`❎ Error: Could not download the video. ${error.message}`);
  }
}

handler.help = ['ytmp4 <url>']
handler.tags = ['downloader']
handler.command = ['ytmp4', 'ytv']
handler.desc = 'Download YouTube video using a URL'

export default handler

