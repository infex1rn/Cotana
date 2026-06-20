import { watchFile, unwatchFile } from 'fs'
import chalk from 'chalk'
import { fileURLToPath } from 'url'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config()

const ownervb = process.env.OWNERS || "2349130476348;INFEXJAY;2349133228349;INFEX1RN"

const ownerlist = ownervb.split(';');

global.owner = [];
for (let i = 0; i < ownerlist.length; i += 2) {
    const owner = [
        ownerlist[i],            
        ownerlist[i + 1],         
        true                        
    ];
    global.owner.push(owner);
}

global.mods = ['2349130476348']
global.allowed = ['2349130476348']

// Sticker WM
global.botname = process.env.BOTNAME || 'COTANA'
global.packname = 'COTANA┃ᴮᴼᵀ'
global.author = 'Infexjay'
global.ownername = 'Infexjay'
global.org = 'INDEVSTUDIO Inc.'
global.thumb = fs.existsSync('./Assets/Cotana.png') ? fs.readFileSync('./Assets/Cotana.png') : null

// Status indicators
global.wait = '*⌛ _Charging..._*\n*▰▰▰▱▱▱▱▱*'
global.rwait = '⌛'
global.dmoji = '🤭'
global.done = '✅'
global.error = '❌'
global.xmoji = '🔥'

global.multiplier = 69
global.maxwarn = '3'

let file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  unwatchFile(file)
  console.log(chalk.redBright("Update 'config.js'"))
  import(`${file}?update=${Date.now()}`)
})
