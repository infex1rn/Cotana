import { cpus as _cpus, totalmem, freemem, platform, arch, hostname, release, networkInterfaces, uptime, loadavg } from 'os'
import util from 'util'
import { performance } from 'perf_hooks'
import { sizeFormatter } from 'human-readable'
import { exec } from 'child_process'
import { promisify } from 'util'
import { persona, formatResponse } from '../lib/responses.js'

const execAsync = promisify(exec)

let format = sizeFormatter({
  std: 'JEDEC', // 'SI' (default) | 'IEC' | 'JEDEC'
  decimalPlaces: 2,
  keepTrailingZeroes: false,
  render: (literal, symbol) => `${literal} ${symbol}B`,
})

let handler = async (m, { conn, usedPrefix, command }) => {
  const chats = Object.entries(conn.chats).filter(([id, data]) => id && data.isChats)
  const groupsIn = chats.filter(([id]) => id.endsWith('@g.us')) //groups.filter(v => !v.read_only)
  const used = process.memoryUsage()
  const cpus = _cpus().map(cpu => {
    cpu.total = Object.keys(cpu.times).reduce((last, type) => last + cpu.times[type], 0)
    return cpu
  })
  const cpu = cpus.reduce(
    (last, cpu, _, { length }) => {
      last.total += cpu.total
      last.speed += cpu.speed / length
      last.times.user += cpu.times.user
      last.times.nice += cpu.times.nice
      last.times.sys += cpu.times.sys
      last.times.idle += cpu.times.idle
      last.times.irq += cpu.times.irq
      return last
    },
    {
      speed: 0,
      total: 0,
      times: {
        user: 0,
        nice: 0,
        sys: 0,
        idle: 0,
        irq: 0,
      },
    }
  )
  
  let old = performance.now()
  let neww = performance.now()
  let speed = neww - old
  
  let systemInfo = {}
  try {
    const { stdout: distro } = await execAsync('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2')
    systemInfo.os = distro.replace(/"/g, '').trim() || `${platform()} ${release()}`
  } catch {
    systemInfo.os = `${platform()} ${release()}`
  }
  
  systemInfo.arch = arch()
  systemInfo.hostname = hostname()
  systemInfo.cpuCores = cpus.length
  systemInfo.cpuModel = cpus[0]?.model || 'Unknown CPU'
  systemInfo.cpuSpeed = `${(cpu.speed / 1000).toFixed(2)} GHz`
  systemInfo.loadAverage = loadavg().map(x => x.toFixed(2)).join(', ')
  systemInfo.uptime = formatUptime(uptime())
  
  try {
    const { stdout: diskInfo } = await execAsync('df -h / | tail -1')
    const diskParts = diskInfo.trim().split(/\s+/)
    if (diskParts.length >= 5) {
      systemInfo.totalDisk = diskParts[1]
      systemInfo.usedDisk = diskParts[2]
      systemInfo.freeDisk = diskParts[3]
      systemInfo.diskUsage = diskParts[4]
    }
  } catch {
    systemInfo.diskInfo = 'Not available'
  }
  
  let who = m.quoted
    ? m.quoted.sender
    : m.mentionedJid && m.mentionedJid[0]
      ? m.mentionedJid[0]
      : m.fromMe
        ? conn.user.jid
        : m.sender
  if (!(who in global.db.data.users)) throw `✳️ The user is not found in my database`
  let user = global.db.data.users[who]

  let infobt = `
*${persona.fullName} INFO*

*SYSTEM CORE*
✧ OS: ${systemInfo.os}
✧ Architecture: ${systemInfo.arch}
✧ Uptime: ${systemInfo.uptime}
✧ CPU Model: ${systemInfo.cpuModel}
✧ Load Average: ${systemInfo.loadAverage}

*MEMORY & STORAGE*
✧ RAM: ${format(totalmem() - freemem())} / ${format(totalmem())}
✧ Free RAM: ${format(freemem())}
${systemInfo.totalDisk ? `✧ Disk: ${systemInfo.usedDisk} / ${systemInfo.totalDisk} (${systemInfo.diskUsage})` : ''}

*NETWORK PROTOCOLS*
✧ Groups: ${groupsIn.length}
✧ Private: ${chats.length - groupsIn.length}
✧ Total: ${chats.length}

*ORIGIN & IDENTITY*
✧ Name: ${persona.fullName}
✧ Creator: ${persona.creator}
✧ Organization: ${persona.organization}
✧ Vibe: ${persona.vibe}

© ${persona.organization} 2025`

  let logo = './Assets/Cotana-logo.png'

  await conn.sendMessage(m.chat, {
    image: { url: logo },
    caption: formatResponse(infobt),
    mentions: [who]
  }, { quoted: m })
  
  m.react('🎯')
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24))
  const hours = Math.floor((seconds % (3600 * 24)) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  return `${days}d ${hours}h ${minutes}m ${secs}s`
}

handler.help = ['info']
handler.tags = ['main']
handler.command = ['info', 'infobot', 'botinfo']
handler.desc = 'Display bot information, system stats, and user info'

export default handler
