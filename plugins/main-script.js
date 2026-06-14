import { promises } from 'fs'
import { join } from 'path'
import axios from 'axios'

let handler = async function (m, { conn, __dirname }) {
  const githubRepoURL = 'https://github.com/cotana322/cotana-BOT'

  try {
    const [, username, repoName] = githubRepoURL.match(/github\.com\/([^/]+)\/([^/]+)/)
    const response = await axios.get(`https://api.github.com/repos/${username}/${repoName}`)

    if (response.status === 200) {
      const repoData = response.data
      const formattedInfo = `
*MY SOURCE CODE* 🌪️🍭

Wanna see how I work? 😈 Just don't break anything!

✧ Name: ${repoData.name}
✧ Stars: ${repoData.stargazers_count}
✧ Forks: ${repoData.forks_count}
✧ URL: ${repoData.html_url}

Stay nutty! 💋✨
      `.trim()

      await conn.sendMessage(m.chat, {
        image: { url: './Assets/Cotana-logo.png' },
        caption: formatResponse(formattedInfo)
      }, { quoted: m })
    } else {
      await m.reply(formatResponse('Ugh, GitHub is being slow. I can\'t show you my secrets right now! 💅✨'))
    }
  } catch (error) {
    await m.reply(formatResponse('An error occurred while fetching my source info. Try again later, darling! 🐍'))
  }
}

handler.help = ['script']
handler.tags = ['main']
handler.command = ['sc', 'repo', 'script']
handler.desc = 'Get the GitHub repository information of cotana-Ai'

export default handler
