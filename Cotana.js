process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1'
import './config.js'

import dotenv from 'dotenv'
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, watch } from 'fs'
import { createRequire } from 'module'
import path, { join } from 'path'
import { platform } from 'process'
import { fileURLToPath, pathToFileURL } from 'url'
import * as ws from 'ws'
import { useMongoDBAuthState } from './lib/auth/mongo-auth.js'
import * as mongoStore from './lib/auth/mongo-store.js'
import NodeCache from 'node-cache'
import { MongoDB } from './lib/mongoDB.js'

global.__filename = function filename(pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
  return rmPrefix
    ? /file:\/\/\//.test(pathURL)
      ? fileURLToPath(pathURL)
      : pathURL
    : pathToFileURL(pathURL).toString()
}
global.__dirname = function dirname(pathURL) {
  return path.dirname(global.__filename(pathURL, true))
}
global.__require = function require(dir = import.meta.url) {
  return createRequire(dir)
}
global.cotanabot = 'https://api.cotana.tech/api' // Placeholder for Cotana API

import chalk from 'chalk'
import { spawn } from 'child_process'
import lodash from 'lodash'
import { default as Pino, default as pino } from 'pino'
import syntaxerror from 'syntax-error'
import { format } from 'util'
import yargs from 'yargs'
import { makeWASocket, protoType, serialize } from './lib/simple.js'

import makeWASocketPackage, * as baileys from '@whiskeysockets/baileys'
const pkg = { ...baileys, default: makeWASocketPackage }
const {
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  proto,
  delay,
  useMultiFileAuthState
} = pkg

const makeWASocketDefault = pkg.default || pkg
// Re-map delay to maintain compatibility
const MessageRetryMap = {} 


dotenv.config()

const groupMetadataCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'cotana_bot'

const globalDB = new MongoDB(MONGODB_URI)

global.db = globalDB

global.loadDatabase = async function loadDatabase() {
  try {
    await global.db.read()
    global.db.data = {
      users: {},
      chats: {},
      settings: {},
      stats: {},
      ...(global.db.data || {})
    }
  } catch (error) {
    console.warn(
      chalk.yellow(`MongoDB data store unavailable; using in-memory data store: ${error.message}`)
    )
    global.db = {
      data: {
        users: {},
        chats: {},
        settings: {},
        stats: {}
      },
      async read() {
        return this.data
      },
      async write(data = this.data) {
        this.data = data
        return true
      },
      async close() {}
    }
  }
}

setInterval(async () => {
  if (global.db.data) await global.db.write(global.db.data)
}, 60 * 1000)

await global.loadDatabase()

const phoneNumberFromEnv = process.env.PHONE_NUMBER

const MAIN_LOGGER = pino({ timestamp: () => `,"time":"${new Date().toJSON()}"` })

const logger = MAIN_LOGGER.child({})
logger.level = 'fatal'

const msgRetryCounterCache = new NodeCache()

const { CONNECTING } = ws
const { chain } = lodash
const PORT = process.env.PORT || process.env.SERVER_PORT || 3000

protoType()
serialize()

global.API = (name, path = '/', query = {}) =>
  name + path + (query ? '?' + new URLSearchParams(Object.entries(query)) : '')
global.timestamp = {
  start: new Date(),
}

const __dirname = global.__dirname(import.meta.url)
global.opts = new Object(yargs(process.argv.slice(2)).exitProcess(false).parse())
global.prefix = new RegExp(
  '^[' +
    (process.env.PREFIX || '*/i!#$%+£¢€¥^°=¶∆×÷π√✓©®:;?&.\\-.@').replace(
      /[|\\{}()[\]^$+*?.\-\^]/g,
      '\\$&'
    ) +
    ']'
)
global.opts['db'] = process.env.MONGODB_URI


let authState
try {
  authState = await useMongoDBAuthState(MONGODB_URI, DB_NAME)
} catch (error) {
  console.warn(
    chalk.yellow(`MongoDB auth store unavailable; using local session files: ${error.message}`)
  )
  mkdirSync(join(__dirname, 'session'), { recursive: true })
  authState = await useMultiFileAuthState(join(__dirname, 'session'))
}

const {
  state,
  saveCreds,
  closeConnection = async () => {}
} = authState

const { version: waWebVersion } = await fetchLatestBaileysVersion().catch(async error => {
  console.warn(
    chalk.yellow(`Unable to fetch latest Baileys version; trying WhatsApp Web version: ${error.message}`)
  )
  return fetchLatestWaWebVersion().catch(waError => {
    console.warn(
      chalk.yellow(`Unable to fetch latest WhatsApp Web version; using bundled fallback: ${waError.message}`)
    )
    return { version: [2, 3000, 1017531287] }
  })
})

const connectionOptions = {
  logger: Pino({
    level: 'fatal',
  }),
  printQRInTerminal: false,
  version: waWebVersion,
  browser: Browsers.ubuntu('Chrome'),
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(
      state.keys,
      Pino().child({
        level: 'fatal',
        stream: 'store',
      })
    ),
  },
  markOnlineOnConnect: true,
  generateHighQualityLinkPreview: true,
  cachedGroupMetadata: async (jid) => {
    const cached = groupMetadataCache.get(jid)
    if (cached) return cached
    try {
      const mongoMeta = await mongoStore.groupMetadata(jid, DB_NAME)
      if (mongoMeta) groupMetadataCache.set(jid, mongoMeta)
      return mongoMeta || null
    } catch (e) {
      return null
    }
  },
  getMessage: async key => {
    let jid = jidNormalizedUser(key.remoteJid)
    let msg = await mongoStore.loadMessage(key.id, jid, DB_NAME)
    return msg?.message || ''
  },
  patchMessageBeforeSending: message => {
    const requiresPatch = !!(
      message.buttonsMessage ||
      message.templateMessage ||
      message.listMessage
    )
    if (requiresPatch) {
      message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadataVersion: 2,
              deviceListMetadata: {},
            },
            ...message,
          },
        },
      }
    }

    return message
  },
  msgRetryCounterCache,
  defaultQueryTimeoutMs: undefined,
  syncFullHistory: false,
}

global.conn = makeWASocket(connectionOptions)
conn.isInit = false

let pairingPhoneNumber = null
let pairingAttempts = 0
let pairingRequestInFlight = false
let pairingRequestCompleted = false

async function requestPairingCode(trigger = 'connection.update') {
  if (
    pairingRequestCompleted ||
    pairingRequestInFlight ||
    conn.authState.creds.registered ||
    !pairingPhoneNumber
  ) {
    return false
  }

  pairingRequestInFlight = true
  pairingAttempts += 1

  try {
    let code = await conn.requestPairingCode(pairingPhoneNumber)
    code = code?.match(/.{1,4}/g)?.join('-') || code

    global.pairingCode = code
    pairingRequestCompleted = true

    const pairingCodeFormatted = chalk.bold.greenBright('Your Pairing Code:') + ' ' + chalk.bgGreenBright(chalk.black(code))
    console.log(pairingCodeFormatted)

    if (process.send) {
      process.send({
        type: 'pairing-code',
        code: code,
        error: false
      })
    }
    return true
  } catch (error) {
    console.log(
      chalk.bgBlack(chalk.redBright(`Failed to generate pairing code after ${trigger}:`)),
      error
    )

    if (pairingAttempts >= 6 && process.send) {
      process.send({
        type: 'pairing-code',
        code: 'ERROR: Failed to generate pairing code',
        error: true
      })
    }
    return false
  } finally {
    pairingRequestInFlight = false
  }
}

if (!conn.authState.creds.registered) {
  if (phoneNumberFromEnv) {
    pairingPhoneNumber = phoneNumberFromEnv.replace(/[^0-9]/g, '')

    if (!/^\d{8,15}$/.test(pairingPhoneNumber)) {
      console.log(
        chalk.bgBlack(chalk.redBright("Invalid phone number format. Use E.164 format without + (Example: 2348100835767)"))
      )
      if (process.send) {
        process.send({
          type: 'pairing-code',
          code: 'ERROR: Invalid phone number format',
          error: true
        })
      }
      process.exit(0)
    }
  } else {
    console.log(chalk.red("No phone number provided. Please set the PHONE_NUMBER environment variable."))
    if (process.send) {
      process.send({
        type: 'pairing-code',
        code: 'ERROR: No phone number provided',
        error: true
      })
    }
    process.exit(0)
  }
}

conn.logger.info('\nWaiting For Login\n')

if (!conn.authState.creds.registered && pairingPhoneNumber) {
  setTimeout(() => {
    requestPairingCode('socket-ready').catch(error => {
      console.error('Error requesting initial pairing code:', error)
    })
  }, 3000)
}

if (!opts['test']) {
  if (global.db) {
    setInterval(async () => {
      if (global.db.data) await global.db.write(global.db.data)
    }, 30 * 1000)
  }
}

if (opts['server']) (await import('./server.js')).default(global.conn, PORT)

async function connectionUpdate(update) {
  const { connection, lastDisconnect, isNewLogin, qr } = update
  global.stopped = connection

  if (isNewLogin) conn.isInit = true

  if (
    !conn.authState.creds.registered &&
    pairingPhoneNumber &&
    (connection === 'connecting' || qr)
  ) {
    await requestPairingCode(qr ? 'qr' : 'connecting')
  }

  const code =
    lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.output?.payload?.statusCode

  if (code && code !== DisconnectReason.loggedOut && conn?.ws.socket == null) {
    try {
      conn.logger.info(await global.reloadHandler(true))
    } catch (error) {
      console.error('Error reloading handler:', error)
    }
  }

  if (code && (code === DisconnectReason.restartRequired || code === 428)) {
    conn.logger.info(chalk.yellow('\n🚩 Restart Required... Preparing for restart'))
    
    try {
      if (global.db.data) {
        conn.logger.info(chalk.blue('Saving database before restart...'))
        await global.db.write(global.db.data)
        conn.logger.info(chalk.green('Database saved successfully'))
      }
    } catch (error) {
      console.error('Error saving database before restart:', error)
    }
    
    if (process.send) {
      process.send('reset')
    } else {
      conn.logger.info(chalk.yellow('Reloading handler...'))
      await global.reloadHandler(true)
    }
  }

  if (global.db.data == null) loadDatabase()

  if (connection === 'open') {
    if (process.send) {
      process.send({ 
        type: 'connection-status', 
        connected: true 
      })
    }
    
    const { jid, name } = conn.user
    
    try {
      const dashboardStats = await generateDatabaseStats()
      conn.logger.info(chalk.cyan('\n' + dashboardStats + '\n'))
      
      const welcomeMessage = `*🤖 COTANA-BOT DASHBOARD*\n\nHai ${name}, your bot is now online!\n\n${dashboardStats}`

      await conn.sendMessage(jid, { text: welcomeMessage }, { quoted: null })
    } catch (error) {
      console.error('Error generating dashboard:', error)
      const msg = `Hai🤩 ${name}, Congrats you have successfully deployed COTANA-BOT`
      await conn.sendMessage(jid, { text: msg, mentions: [jid] }, { quoted: null })
    }

    conn.logger.info(chalk.yellow('\n🚩 R E A D Y'))
  }

  if (connection === 'close') {
    pairingRequestInFlight = false
    if (process.send) {
      process.send({ 
        type: 'connection-status', 
        connected: false 
      })
    }
    conn.logger.error(chalk.yellow(`\nConnection closed... Get a new session`))
  }
}

conn.ev.on('messaging-history.set', ({ messages }) => {
  if (messages && messages.length > 0) {
    mongoStore.saveMessages({ messages, type: 'append' }, DB_NAME)
  }
})
conn.ev.on('contacts.update', async (contacts) => {
  for (const contact of contacts) await mongoStore.saveContact(contact, DB_NAME)
})
conn.ev.on('contacts.upsert', async (contacts) => {
  for (const contact of contacts) await mongoStore.saveContact(contact, DB_NAME)
})
conn.ev.on('messages.upsert', ({ messages }) => {
  mongoStore.saveMessages({ messages, type: 'upsert' }, DB_NAME)
})
conn.ev.on('messages.update', async (messageUpdates) => {
  mongoStore.saveMessages({ messages: messageUpdates, type: 'update' }, DB_NAME)
})
conn.ev.on('message-receipt.update', async (messageReceipts) => {
  mongoStore.saveReceipts(messageReceipts, DB_NAME)
})
conn.ev.on('groups.update', async ([event]) => {
  if (event.id) {
    const metadata = await conn.groupMetadata(event.id)
    if (metadata) {
      groupMetadataCache.set(event.id, metadata)
      await mongoStore.saveGroupMetadata(event.id, metadata, DB_NAME).catch(() => {})
    }
  }
})
conn.ev.on('group-participants.update', async (event) => {
  if (event.id) {
    const metadata = await conn.groupMetadata(event.id)
    if (metadata) {
      groupMetadataCache.set(event.id, metadata)
      await mongoStore.saveGroupMetadata(event.id, metadata, DB_NAME).catch(() => {})
    }
  }
})

process.on('exit', async () => { await closeConnection() })
process.on('SIGINT', async () => { await closeConnection(); process.exit(0) })
process.on('SIGTERM', async () => { await closeConnection(); process.exit(0) })

process.on('uncaughtException', console.error)

let isInit = true
let handler = await import('./handler.js')
global.reloadHandler = async function (restatConn) {
  try {
    const Handler = await import(`./handler.js?update=${Date.now()}`).catch(console.error)
    if (Object.keys(Handler || {}).length) handler = Handler
  } catch (error) {
    console.error
  }
  if (restatConn) {
    const oldChats = global.conn.chats
    try {
      global.conn.ws.close()
    } catch {}
    conn.ev.removeAllListeners()
    global.conn = makeWASocket(connectionOptions, {
      chats: oldChats,
    })
    isInit = true
  }
  if (!isInit) {
    conn.ev.off('messages.upsert', conn.handler)
    conn.ev.off('messages.update', conn.pollUpdate)
    conn.ev.off('group-participants.update', conn.participantsUpdate)
    conn.ev.off('groups.update', conn.groupsUpdate)
    conn.ev.off('message.delete', conn.onDelete)
    conn.ev.off('presence.update', conn.presenceUpdate)
    conn.ev.off('connection.update', conn.connectionUpdate)
    conn.ev.off('creds.update', conn.credsUpdate)
  }

  conn.welcome = ` Hello @user!\n\n🎉 *WELCOME* to the group @group!\n\n📜 Please read the *DESCRIPTION* @desc.`
  conn.bye = `👋GOODBYE @user \n\nSee you later!`
  conn.spromote = `*@user* has been promoted to an admin!`
  conn.sdemote = `*@user* is no longer an admin.`

  conn.handler = handler.handler.bind(global.conn)
  conn.pollUpdate = handler.pollUpdate.bind(global.conn)
  conn.participantsUpdate = handler.participantsUpdate.bind(global.conn)
  conn.groupsUpdate = handler.groupsUpdate.bind(global.conn)
  conn.onDelete = handler.deleteUpdate.bind(global.conn)
  conn.presenceUpdate = handler.presenceUpdate.bind(global.conn)
  conn.connectionUpdate = connectionUpdate.bind(global.conn)
  conn.credsUpdate = saveCreds.bind(global.conn, true)

  conn.ev.on('messages.upsert', conn.handler)
  conn.ev.on('messages.update', conn.pollUpdate)
  conn.ev.on('group-participants.update', conn.participantsUpdate)
  conn.ev.on('groups.update', conn.groupsUpdate)
  conn.ev.on('message.delete', conn.onDelete)
  conn.ev.on('presence.update', conn.presenceUpdate)
  conn.ev.on('connection.update', conn.connectionUpdate)
  conn.ev.on('creds.update', conn.credsUpdate)
  isInit = false
  return true
}

if (process.on) {
  process.on('message', async (data) => {
    if (typeof data === 'object' && data.type === 'request-stats') {
      try {
        const stats = await generateStatsData()
        if (process.send) {
          process.send({ 
            type: 'stats', 
            stats: stats 
          })
        }
      } catch (error) {
        console.error('Error generating stats for parent process:', error)
      }
    }
  })
}

async function generateStatsData() {
  try {
    if (!global.db.data) await global.loadDatabase()
    
    return {
      users: Object.keys(global.db.data.users || {}).length,
      groups: Object.keys(global.db.data.chats || {}).filter(id => id.endsWith('@g.us')).length,
      uptime: formatUptime(process.uptime()),
      memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    }
  } catch (error) {
    console.error("Error generating stats data:", error)
    return { error: "Failed to generate statistics" }
  }
}

const pluginFolder = join(__dirname, 'plugins')
const pluginFilter = filename => /\.js$/.test(filename)
global.plugins = {}
async function filesInit() {
  for (const filename of readdirSync(pluginFolder).filter(pluginFilter)) {
    try {
      const file = global.__filename(join(pluginFolder, filename))
      const module = await import(file)
      global.plugins[filename] = module.default || module
    } catch (e) {
      conn.logger.error(e)
      delete global.plugins[filename]
    }
  }
}
filesInit()
  .then(_ => Object.keys(global.plugins))
  .catch(console.error)

global.reload = async (_ev, filename) => {
  if (pluginFilter(filename)) {
    const dir = global.__filename(join(pluginFolder, filename), true)
    if (filename in global.plugins) {
      if (existsSync(dir)) conn.logger.info(`\nUpdated plugin - '${filename}'`)
      else {
        conn.logger.warn(`\nDeleted plugin - '${filename}'`)
        return delete global.plugins[filename]
      }
    } else conn.logger.info(`\nNew plugin - '${filename}'`)
    const err = syntaxerror(readFileSync(dir), filename, {
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
    })
    if (err) conn.logger.error(`\nSyntax error while loading '${filename}'\n${format(err)}`)
    else {
      try {
        const module = await import(`${global.__filename(dir)}?update=${Date.now()}`)
        global.plugins[filename] = module.default || module
      } catch (e) {
        conn.logger.error(`\nError require plugin '${filename}\n${format(e)}'`)
      } finally {
        global.plugins = Object.fromEntries(
          Object.entries(global.plugins).sort(([a], [b]) => a.localeCompare(b))
        )
      }
    }
  }
}
Object.freeze(global.reload)
watch(pluginFolder, global.reload)
await global.reloadHandler()

async function generateDatabaseStats() {
  try {
    if (!global.db.data) await global.loadDatabase()
    
    const stats = {
      users: Object.keys(global.db.data.users || {}).length,
      groups: Object.keys(global.db.data.chats || {}).filter(id => id.endsWith('@g.us')).length,
      uptime: formatUptime(process.uptime()),
      memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
    }
    
    return `
┌─────────────────────────────┐
│   🤖 COTANA-BOT DASHBOARD 🤖 │
├─────────────────────────────┤
│                             │
│ 👥 Users: ${padRight(stats.users, 19)} │
│ 👥 Groups: ${padRight(stats.groups, 18)} │
│                             │
│ ⏱️ Uptime: ${padRight(stats.uptime, 18)} │
│ 💾 Memory: ${padRight(stats.memoryUsage, 18)} │
│                             │
└─────────────────────────────┘
    `.trim()
  } catch (error) {
    console.error("Error generating dashboard:", error)
    return "Error generating dashboard statistics"
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24))
  const hours = Math.floor((seconds % (3600 * 24)) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  let result = ''
  if (days > 0) result += `${days}d `
  if (hours > 0) result += `${hours}h `
  result += `${minutes}m`
  
  return result
}

function padRight(text, length) {
  return String(text).padEnd(length)
}
