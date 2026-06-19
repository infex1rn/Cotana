import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { persona, formatResponse } from '../lib/responses.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let tags = {
  'main': '👑 MAIN',
  'tools': '🧰 TOOLS',
  'downloader': '📥 DOWNLOADER',
  'group': '👥 GROUP',
  'owner': '👑 OWNER'
}

const categoryAliases = {
  gp: 'group',
  group: 'group',
  tools: 'tools',
  tool: 'tools',
  dl: 'downloader',
  download: 'downloader',
  downloader: 'downloader',
  main: 'main',
  owner: 'owner'
}

const defaultMenu = {
  before: `
Hii darling! 😈 Ready to see what I can do? 
Try to keep up, okay? 🌪️🍭

%readmore`.trimStart(),
  header: '✨🍒 *%category* 🍒✨',
  body: '┃ 👉 *%cmd*',
  footer: '🌸💅 *══════════════* 💅🌸\n',
  after: `© ${persona.organization}`,
}

let handler = async (m, { conn, usedPrefix: _p, args, command }) => {
  try {
    const pluginsDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'plugins')
    
    let pluginFiles;
    try {
      pluginFiles = await fs.readdir(pluginsDir);
    } catch (e) {
      console.error('Error reading plugins directory:', e);
      return m.reply(`Failed to read plugins directory: ${e.message}`);
    }
    
    let commandsMap = {}
    let descMap = {}
    
    for (let tag in tags) {
      commandsMap[tag] = [];
    }
    
    for (let file of pluginFiles) {
      if (!file.endsWith('.js')) continue
      
      try {
        let filePath = path.join(pluginsDir, file);
        const plugin = (await import(filePath)).default;
        
        if (!plugin || !plugin.help || !plugin.tags) continue
        
        let pluginTags = Array.isArray(plugin.tags) ? plugin.tags : [plugin.tags];
        
        for (const tag of pluginTags) {
          if (!(tag in tags)) continue;
          
          let help = Array.isArray(plugin.help) ? plugin.help : [plugin.help];
          
          for (let cmd of help) {
            if (!commandsMap[tag]) commandsMap[tag] = [];
            commandsMap[tag].push(cmd);
            if (plugin.desc) descMap[cmd] = plugin.desc;
          }
        }
      } catch (e) {
        continue
      }
    }
    
    let tag = args[0]?.toLowerCase();
    if (!tag && command?.startsWith('list') && command.length > 4) tag = command.slice(4).toLowerCase();
    tag = categoryAliases[tag] || tag;
    let text = defaultMenu.before;
    
    if (tag && tags[tag] && commandsMap[tag]) {
      text += generateMenu(defaultMenu, tags[tag], commandsMap[tag], _p, descMap)
    } else {
      for (let tag in commandsMap) {
        if (!commandsMap[tag] || commandsMap[tag].length === 0) continue;
        text += generateMenu(defaultMenu, tags[tag], commandsMap[tag], _p, descMap)
      }
    }
    
    text += defaultMenu.after;
    
    let replace = {
      '%readmore': readMore(defaultMenu.before.length),
      '%username': conn.getName(m.sender),
      '%botname': persona.name,
    }
    
    for (let [key, value] of Object.entries(replace)) {
      text = text.replace(new RegExp(key, 'g'), value)
    }
    
    const logo = './Assets/Cotana.png'
    await sendListMessage(
      conn,
      m,
      formatResponse(`${text.trim()}\n\n.ping - Speed\nhttps://github.com/cotana322`),
      logo
    )
    
  } catch (e) {
    console.error('Main error in list command:', e);
    m.reply(`Error generating command list: ${e.message}`)
  }
}

function generateMenu(menu, category, commands, prefix, descMap) {
  let text = menu.header.replace(/%category/g, category) + '\n'
  for (let command of commands) {
    let cmd = command.replace(/:/g, '')
    text += menu.body.replace(/%cmd/g, prefix + cmd) + '\n'
  }
  return text + menu.footer
}

function readMore(length) {
  return String.fromCharCode(8206).repeat(4001 - length)
}

handler.help = ['list', 'listcmd', 'cmdlist', 'listgp', 'listtools', 'listdl', 'listmain', 'listowner']
handler.tags = ['main']
handler.command = /^(list|listcmd|cmdlist|listgp|listgroup|listtools?|listdl|listdownload(?:er)?|listmain|listowner)$/i
handler.desc = 'Lists available commands by category. Use .listgp, .listtools, .listdl, .listmain, .listowner, or .list <category>.'

export default handler

async function sendListMessage(conn, m, text, logo) {
  try {
    await conn.sendMessage(m.chat, { image: { url: logo }, caption: text }, { quoted: m })
  } catch (error) {
    console.error('List media send failed, falling back to text:', error)
    await conn.sendMessage(m.chat, { text }, { quoted: m })
  }
}
