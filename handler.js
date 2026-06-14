import { persona, formatResponse } from './lib/responses.js'
import { startSession, updateSession, isSessionActive, setupTimeout } from './lib/sessions.js'
import { smsg } from './lib/simple.js'
import { format } from 'util'
import { fileURLToPath } from 'url'
import path, { join } from 'path'
import { unwatchFile, watchFile } from 'fs'
import chalk from 'chalk'
import fetch from 'node-fetch'
import Pino from 'pino'
import { loadMessage as mongoLoadMessage } from './lib/auth/mongo-store.js'

/**
 * @type {import("@whiskeysockets/baileys")}
 */

// Utility functions
const isNumber = x => typeof x === 'number' && !isNaN(x)
const delay = ms =>
  isNumber(ms) &&
  new Promise(resolve =>
    setTimeout(function () {
      clearTimeout(this)
      resolve()
    }, ms)
  )

/**
 * Handle messages upsert
 * @param {import("@whiskeysockets/baileys").BaileysEventMap<unknown>["messages.upsert"]} groupsUpdate
 */
import makeWASocketPackage, * as baileys from '@whiskeysockets/baileys'
const pkg = { ...baileys, default: makeWASocketPackage }
const { getAggregateVotesInPollMessage } = pkg

export async function handler(chatUpdate) {
  this.msgqueque = this.msgqueque || []
  if (!chatUpdate) return
  this.pushMessage(chatUpdate.messages).catch(console.error)
  let m = chatUpdate.messages[chatUpdate.messages.length - 1]
  if (!m) return
  if (global.db.data == null) await global.loadDatabase()
  // Ensure settings is always defined before any try/catch
  let settings = global.db?.data?.settings?.[this.user?.jid] || {}
  try {
    m = smsg(this, m) || m
    if (!m) return
    
    if (m.message) {
      if (m.message.buttonsResponseMessage) {
        m.text = m.message.buttonsResponseMessage.selectedButtonId || ''
      } else if (m.message.templateButtonReplyMessage) {
        m.text = m.message.templateButtonReplyMessage.selectedId || ''
      } else if (m.message.listResponseMessage) {
        m.text = m.message.listResponseMessage.singleSelectReply.selectedRowId || ''
      }
    }
    
    try {
      let user = global.db.data.users[m.sender]
      if (typeof user !== 'object') global.db.data.users[m.sender] = {}
      if (user) {
        if (!('warn' in user)) user.warn = 0
        if (!('registered' in user)) user.registered = false
        if (!user.registered) {
          if (!('name' in user)) user.name = m.name
          if (!('age' in user)) user.age = -1
          if (!isNumber(user.regTime)) user.regTime = -1
        }
        if (!isNumber(user.afk)) user.afk = -1
        if (!('afkReason' in user)) user.afkReason = ''
        if (!('banned' in user)) user.banned = false
      } else {
        global.db.data.users[m.sender] = {
          warn: 0,
          registered: false,
          name: m.name,
          age: -1,
          regTime: -1,
          afk: -1,
          afkReason: '',
          banned: false,
        }
      }
      let chat = global.db.data.chats[m.chat]
      if (typeof chat !== 'object') global.db.data.chats[m.chat] = {}
      // Ensure settings is always defined before use
      settings = global.db.data.settings[this.user.jid]
      if (typeof settings !== 'object') global.db.data.settings[this.user.jid] = {}
      settings = global.db.data.settings[this.user.jid]
      if (chat) {
        if (!('antiDelete' in chat)) chat.antiDelete = true
        if (!('antiLink' in chat)) chat.antiLink = false
        if (!('antiSticker' in chat)) chat.antiSticker = false
        if (!('antiToxic' in chat)) chat.antiToxic = false
        if (!('detect' in chat)) chat.detect = false
        if (!('isBanned' in chat)) chat.isBanned = false
        if (!('nsfw' in chat)) chat.nsfw = false
        if (!('sBye' in chat)) chat.sBye = ''
        if (!('sDemote' in chat)) chat.sDemote = ''
        if (!('sPromote' in chat)) chat.sPromote = ''
        if (!('sWelcome' in chat)) chat.sWelcome = ''
        if (!('welcome' in chat)) chat.welcome = false
        if (!('chatbot' in chat)) chat.chatbot = false
      } else {
        global.db.data.chats[m.chat] = {
          antiDelete: true,
          antiLink: false,
          antiSticker: false,
          antiToxic: false,
          detect: false,
          isBanned: false,
          nsfw: false,
          sBye: '',
          sDemote: '',
          sPromote: '',
          sWelcome: '',
          welcome: false,
          chatbot: false,
        }
      }
      if (typeof settings !== 'object') global.db.data.settings[this.user.jid] = {}
      if (settings) {
        if (!('self' in settings)) settings.self = false
        if (!('autoread' in settings)) settings.autoread = false
        if (!('restrict' in settings)) settings.restrict = false
        if (!('restartDB' in settings)) settings.restartDB = 0
        if (!('status' in settings)) settings.status = 0
        if (!('pconly' in settings)) settings.pconly = false
        if (!('gconly' in settings)) settings.gconly = false
      } else {
        global.db.data.settings[this.user.jid] = {
          self: false,
          autoread: false,
          restrict: false,
          restartDB: 0,
          status: 0,
          pconly: false,
          gconly: false,
        }
      }
    } catch (e) {
      console.error(e)
      // fallback: ensure settings is still defined
      settings = global.db?.data?.settings?.[this.user?.jid] || {}
    }
    // Option checks
    if (settings.pconly && m.chat.endsWith('g.us')) return
    if (settings.gconly && !m.chat.endsWith('g.us')) return
    if (opts['nyimak']) return
    if (opts['pconly'] && m.chat.endsWith('g.us')) return
    if (opts['gconly'] && !m.chat.endsWith('g.us')) return
    if (opts['swonly'] && m.chat !== 'status@broadcast') return
    if (typeof m.text !== 'string') m.text = ''

    // Cotana Persona & Session Management
    const wakeWords = ['hey cotana', 'cotana']
    const isWakeWord = wakeWords.some(word => m.text.toLowerCase().startsWith(word))
    
    if (isWakeWord) {
      startSession(m.chat, m.sender)
      setupTimeout(m.chat, this)
      if (m.text.toLowerCase().trim() === 'hey cotana' || m.text.toLowerCase().trim() === 'cotana') {
        return m.reply(formatResponse(persona.messages.sessionStart))
      }
    } else if (isSessionActive(m.chat)) {
      updateSession(m.chat, m.sender)
      setupTimeout(m.chat, this)
    }

    // Check if it's a command
    const isCommand = global.prefix.test(m.text)

    // Route to AI Chat if session is active and not a command
    if (isSessionActive(m.chat) && !isCommand && !m.isBaileys && !m.fromMe && m.text) {
      const aiChatPlugin = global.plugins['ai-chat.js']
      if (aiChatPlugin) {
        try {
          await aiChatPlugin.default(m, { conn: this, text: m.text, usedPrefix: '', command: 'ai' })
          return // Stop further processing
        } catch (e) {
          console.error('Session AI Chat Error:', e)
        }
      }
    }

    // Owner/mod checks
    const isROwner = [
      conn.decodeJid(global.conn.user.id),
      ...global.owner.map(([number]) => number),
    ]
      .map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
      .includes(m.sender)
    const isOwner = isROwner || m.fromMe
    const isMods =
      isOwner ||
      global.mods.map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net').includes(m.sender)

    // Message queue for non-mods
    if (opts['queque'] && m.text && !isMods) {
      let queque = this.msgqueque,
        time = 1000 * 5
      const previousID = queque[queque.length - 1]
      queque.push(m.id || m.key.id)
      setInterval(async function () {
        if (queque.indexOf(previousID) === -1) clearInterval(this)
        await delay(time)
      }, time)
    }
    if (process.env.MODE && process.env.MODE.toLowerCase() === 'private' && !(isROwner || isOwner))
      return
    if (m.isBaileys) return

    // Group/participant context
    let usedPrefix
    const groupMetadata =
      (m.isGroup
        ? (conn.chats[m.chat] || {}).metadata || (await this.groupMetadata(m.chat).catch(_ => null))
        : {}) || {}
    const participants = (m.isGroup ? groupMetadata.participants : []) || []
    const user = (m.isGroup ? participants.find(u => conn.decodeJid(u.id) === m.sender) : {}) || {}
    const bot =
      (m.isGroup ? participants.find(u => conn.decodeJid(u.id) == conn.user.jid) : {}) || {}
    const isRAdmin = user?.admin == 'superadmin' || false
    const isAdmin = isRAdmin || user?.admin == 'admin' || false
    const isBotAdmin = bot?.admin || false

    // Plugin execution
    const ___dirname = path.join(path.dirname(fileURLToPath(import.meta.url)), './plugins')
    for (let name in global.plugins) {
      let plugin = global.plugins[name]
      if (!plugin) continue
      if (plugin.disabled) continue
      const __filename = join(___dirname, name)
      if (typeof plugin.all === 'function') {
        try {
          await plugin.all.call(this, m, {
            chatUpdate,
            __dirname: ___dirname,
            __filename,
          })
        } catch (e) {
          console.error(e)
          for (let [jid] of global.owner.filter(
            ([number, _, isDeveloper]) => isDeveloper && number
          )) {
            let data = (await conn.onWhatsApp(jid))[0] || {}
            if (data.exists)
              m.reply(
                `*🗂️ Plugin:* ${name}\n*👤 Sender:* ${m.sender}\n*💬 Chat:* ${m.chat}\n*💻 Command:* ${m.text}\n\n\${format(e)}`.trim(),
                data.jid
              )
          }
        }
      }
      if (!opts['restrict'])
        if (plugin.tags && plugin.tags.includes('admin')) {
          continue
        }
      const str2Regex = str => str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
      let _prefix = plugin.customPrefix
        ? plugin.customPrefix
        : conn.prefix
          ? conn.prefix
          : global.prefix
      let match = (
        _prefix instanceof RegExp
          ? [[_prefix.exec(m.text), _prefix]]
          : Array.isArray(_prefix)
            ? _prefix.map(p => {
                let re =
                  p instanceof RegExp
                    ? p
                    : new RegExp(str2Regex(p))
                return [re.exec(m.text), re]
              })
            : typeof _prefix === 'string'
              ? [[new RegExp(str2Regex(_prefix)).exec(m.text), new RegExp(str2Regex(_prefix))]]
              : [[[], new RegExp()]]
      ).find(p => p[1])
      if (typeof plugin.before === 'function') {
        if (
          await plugin.before.call(this, m, {
            match,
            conn: this,
            participants,
            groupMetadata,
            user,
            bot,
            isROwner,
            isOwner,
            isRAdmin,
            isAdmin,
            isBotAdmin,
            chatUpdate,
            __dirname: ___dirname,
            __filename,
          })
        )
          continue
      }
      if (typeof plugin !== 'function') continue
      let matchedPrefix = (match[0] || '')[0]
      let noPrefix = matchedPrefix ? m.text.replace(matchedPrefix, '') : m.text
      let [command, ...args] = noPrefix.trim().split` `.filter(v => v)
      command = (command || '').toLowerCase()
      let isAcceptWithPrefix =
        plugin.command instanceof RegExp
          ? plugin.command.test(command)
          : Array.isArray(plugin.command)
            ? plugin.command.some(cmd =>
                cmd instanceof RegExp
                  ? cmd.test(command)
                  : cmd === command
              )
            : typeof plugin.command === 'string'
              ? plugin.command === command
              : false
      let isBareAccept =
        !matchedPrefix &&
        !plugin.customPrefix &&
        (Array.isArray(plugin.command)
          ? plugin.command.some(cmd => typeof cmd === 'string' && cmd === command)
          : typeof plugin.command === 'string' && plugin.command === command)
      let isAccept = matchedPrefix ? isAcceptWithPrefix : isBareAccept

      if (matchedPrefix || isAccept) {
        usedPrefix = matchedPrefix || ''
        args = args || []
        let _args = noPrefix.trim().split` `.slice(1)
        let text = _args.join` `
        let fail = plugin.fail || global.dfail

        if (!isAccept) continue
        m.plugin = name
        if (m.chat in global.db.data.chats || m.sender in global.db.data.users) {
          let chat = global.db.data.chats[m.chat]
          let user = global.db.data.users[m.sender]
          if (name != 'owner-unbanchat.js' && chat?.isBanned) return
          if (name != 'owner-unbanuser.js' && user?.banned) return
        }
        if (plugin.rowner && plugin.owner && !(isROwner || isOwner)) {
          fail('owner', m, this)
          continue
        }
        if (plugin.rowner && !isROwner) {
          fail('rowner', m, this)
          continue
        }
        if (plugin.owner && !isOwner) {
          fail('owner', m, this)
          continue
        }
        if (plugin.mods && !isMods) {
          fail('mods', m, this)
          continue
        }
        if (plugin.group && !m.isGroup) {
          fail('group', m, this)
          continue
        } else if (plugin.botAdmin && !isBotAdmin) {
          fail('botAdmin', m, this)
          continue
        } else if (plugin.admin && !isAdmin) {
          fail('admin', m, this)
          continue
        }
        if (plugin.private && m.isGroup) {
          fail('private', m, this)
          continue
        }
        if (plugin.register == true && global.db.data.users[m.sender].registered == false) {
          fail('unreg', m, this)
          continue
        }
        m.isCommand = true
        let extra = {
          match,
          usedPrefix,
          noPrefix,
          _args,
          args,
          command,
          text,
          conn: this,
          participants,
          groupMetadata,
          user,
          bot,
          isROwner,
          isOwner,
          isRAdmin,
          isAdmin,
          isBotAdmin,
          chatUpdate,
          __dirname: ___dirname,
          __filename,
        }
        try {
          await plugin.call(this, m, extra)
        } catch (e) {
          m.error = e
          console.error(e)
          if (e) {
            let text = format(e)
            if (e.name)
              for (let [jid] of global.owner.filter(
                ([number, _, isDeveloper]) => isDeveloper && number
              )) {
                let data = (await this.onWhatsApp(jid))[0] || {}
                if (data.exists)
                  return m.reply(
                    `*🗂️ Plugin:* ${m.plugin}\n*👤 Sender:* ${m.sender}\n*💬 Chat:* ${m.chat}\n*💻 Command:* ${usedPrefix}${command} ${args.join(' ')}\n📄 *Error Logs:*\n\n${text}`.trim(),
                    data.jid
                  )
              }
            m.reply(text)
          }
        } finally {
          if (typeof plugin.after === 'function') {
            try {
              await plugin.after.call(this, m, extra)
            } catch (e) {
              console.error(e)
            }
          }
        }
        break
      }
    }
  } catch (e) {
    console.error(e)
  } finally {
    if (opts['queque'] && m.text) {
      const quequeIndex = this.msgqueque.indexOf(m.id || m.key.id)
      if (quequeIndex !== -1) this.msgqueque.splice(quequeIndex, 1)
    }
    let stats = global.db.data.stats
    if (m) {
      let stat
      if (m.plugin) {
        let now = +new Date()
        if (m.plugin in stats) {
          stat = stats[m.plugin]
          if (!isNumber(stat.total)) stat.total = 1
          if (!isNumber(stat.success)) stat.success = m.error != null ? 0 : 1
          if (!isNumber(stat.last)) stat.last = now
          if (!isNumber(stat.lastSuccess)) stat.lastSuccess = m.error != null ? 0 : now
        } else
          stat = stats[m.plugin] = {
            total: 1,
            success: m.error != null ? 0 : 1,
            last: now,
            lastSuccess: m.error != null ? 0 : now,
          }
        stat.total += 1
        stat.last = now
        if (m.error == null) {
          stat.success += 1
          stat.lastSuccess = now
        }
      }
    }

    try {
      if (!opts['noprint']) await (await import('./lib/print.js')).default(m, this)
    } catch (e) {
      console.log(m, m.quoted, e)
    }
    if (process.env.autoRead) await conn.readMessages([m.key])
    if (process.env.statusview && m.key.remoteJid === 'status@broadcast')
      await conn.readMessages([m.key])
  }
}

/**
 * Handle groups participants update
 * @param {import("@whiskeysockets/baileys").BaileysEventMap<unknown>["group-participants.update"]} groupsUpdate
 */
export async function participantsUpdate({ id, participants, action }) {
  if (opts['self'] || this.isInit) return
  if (global.db.data == null) await loadDatabase()
  const chat = global.db.data.chats[id] || {}
  const emoji = {
    promote: '👤👑',
    demote: '👤🙅‍♂️',
    welcome: '👋',
    bye: '👋',
    bug: '🐛',
    mail: '📮',
    owner: '👑',
  }

  switch (action) {
    case 'add':
      if (chat.welcome) {
        let groupMetadata = (await this.groupMetadata(id)) || (conn.chats[id] || {}).metadata
        for (let user of participants) {
          let pp, ppgp
          try {
            pp = await this.profilePictureUrl(user, 'image')
            ppgp = await this.profilePictureUrl(id, 'image')
          } catch (error) {
            console.error(`Error retrieving profile picture: ${error}`)
            pp = 'https://i.imgur.com/8B4jwGq.jpeg'
            ppgp = 'https://i.imgur.com/8B4jwGq.jpeg'
          } finally {
            let text = (chat.sWelcome || this.welcome || conn.welcome || 'Welcome, @user')
              .replace('@group', await this.getName(id))
              .replace('@desc', groupMetadata.desc?.toString() || 'error')
              .replace('@user', '@' + user.split('@')[0])

            // Use simple static welcome image
            let welcomeImage = 'https://st.depositphotos.com/1823785/2635/i/450/depositphotos_26357899-stock-photo-banner-with-welcome.jpg'

            this.sendMessage(id, {
              text: formatResponse(`*IDENTITY VERIFIED*\n\n${text}\n\nProtocol initialized. ⚡`),
              contextInfo: {
                mentionedJid: [user],
                externalAdReply: {
                  title: 'ᴛʜᴇ ᴄᴏᴛᴀɴᴀ-ʙᴏᴛ',
                  body: 'System: New Identity Detected',
                  thumbnailUrl: welcomeImage,
                  sourceUrl: 'https://github.com',
                  mediaType: 1,
                  renderLargerThumbnail: true,
                },
              },
            })
          }
        }
      }
      break

    case 'remove':
      if (chat.welcome) {
        let groupMetadata = (await this.groupMetadata(id)) || (conn.chats[id] || {}).metadata
        for (let user of participants) {
          let pp, ppgp
          try {
            pp = await this.profilePictureUrl(user, 'image')
            ppgp = await this.profilePictureUrl(id, 'image')
          } catch (error) {
            console.error(`Error retrieving profile picture: ${error}`)
            pp = 'https://i.imgur.com/8B4jwGq.jpeg'
            ppgp = 'https://i.imgur.com/8B4jwGq.jpeg'
          } finally {
            let text = (chat.sBye || this.bye || conn.bye || 'HELLO, @user').replace(
              '@user',
              '@' + user.split('@')[0]
            )

            // Use simple static bye image
            let byeImage = 'https://st5.depositphotos.com/10811838/70765/i/600/depositphotos_707650604-stock-photo-good-bye-phrase-made-wooden.jpg'

            this.sendMessage(id, {
              text: formatResponse(`*IDENTITY REMOVED*\n\n${text}\n\nSession terminated. 💤`),
              contextInfo: {
                mentionedJid: [user],
                externalAdReply: {
                  title: 'ᴛʜᴇ ᴄᴏᴛᴀɴᴀ-ʙᴏᴛ',
                  body: 'System: Identity Terminated',
                  thumbnailUrl: byeImage,
                  sourceUrl: 'https://github.com',
                  mediaType: 1,
                  renderLargerThumbnail: true,
                },
              },
            })
          }
        }
      }
      break
    case 'promote':
      const promoteText = (
        chat.sPromote ||
        this.spromote ||
        conn.spromote ||
        `${emoji.promote} @user *is now admin*`
      ).replace('@user', '@' + participants[0].split('@')[0])

      if (chat.detect) {
        this.sendMessage(id, {
          text: promoteText.trim(),
          mentions: [participants[0]],
        })
      }
      break
    case 'demote':
      const demoteText = (
        chat.sDemote ||
        this.sdemote ||
        conn.sdemote ||
        `${emoji.demote} @user *demoted from admin*`
      ).replace('@user', '@' + participants[0].split('@')[0])

      if (chat.detect) {
        this.sendMessage(id, {
          text: demoteText.trim(),
          mentions: [participants[0]],
        })
      }
      break
  }
}

/**
 * Handle groups update
 * @param {import("@whiskeysockets/baileys").BaileysEventMap<unknown>["groups.update"]} groupsUpdate
 */
export async function groupsUpdate(groupsUpdate) {
  if (opts['self']) return
  for (const groupUpdate of groupsUpdate) {
    const id = groupUpdate.id
    if (!id) continue
    let chats = global.db.data.chats[id] || {}
    const emoji = {
      desc: '📝',
      subject: '📌',
      icon: '🖼️',
      revoke: '🔗',
      announceOn: '🔒',
      announceOff: '🔓',
      restrictOn: '🚫',
      restrictOff: '✅',
    }

    let text = ''
    if (!chats.detect) continue

    if (groupUpdate.desc) {
      text = (
        chats.sDesc ||
        this.sDesc ||
        conn.sDesc ||
        `*${emoji.desc} Description has been changed to*\n@desc`
      ).replace('@desc', groupUpdate.desc)
    } else if (groupUpdate.subject) {
      text = (
        chats.sSubject ||
        this.sSubject ||
        conn.sSubject ||
        `*${emoji.subject} Subject has been changed to*\n@subject`
      ).replace('@subject', groupUpdate.subject)
    } else if (groupUpdate.icon) {
      text = (
        chats.sIcon ||
        this.sIcon ||
        conn.sIcon ||
        `*${emoji.icon} Icon has been changed*`
      ).replace('@icon', groupUpdate.icon)
    } else if (groupUpdate.revoke) {
      text = (
        chats.sRevoke ||
        this.sRevoke ||
        conn.sRevoke ||
        `*${emoji.revoke} Group link has been changed to*\n@revoke`
      ).replace('@revoke', groupUpdate.revoke)
    } else if (groupUpdate.announce === true) {
      text =
        chats.sAnnounceOn ||
        this.sAnnounceOn ||
        conn.sAnnounceOn ||
        `*${emoji.announceOn} Group is now closed!*`
    } else if (groupUpdate.announce === false) {
      text =
        chats.sAnnounceOff ||
        this.sAnnounceOff ||
        conn.sAnnounceOff ||
        `*${emoji.announceOff} Group is now open!*`
    } else if (groupUpdate.restrict === true) {
      text =
        chats.sRestrictOn ||
        this.sRestrictOn ||
        conn.sRestrictOn ||
        `*${emoji.restrictOn} Group is now restricted to participants only!*`
    } else if (groupUpdate.restrict === false) {
      text =
        chats.sRestrictOff ||
        this.sRestrictOff ||
        conn.sRestrictOff ||
        `*${emoji.restrictOff} Group is now restricted to admins only!*`
    }

    if (!text) continue
    await this.sendMessage(id, { text, mentions: this.parseMention(text) })
  }
}

/**
Delete Chat
 */
export async function deleteUpdate(message) {
  try {
    const { fromMe, id } = message
    const remoteJid = message.remoteJid || message.jid
    const participant = message.participant || remoteJid
    if (fromMe) return
    const raw = await mongoLoadMessage(id, remoteJid, process.env.DB_NAME || 'cotana_bot')
    if (!raw) return
    const msg = this.serializeM(raw)
    if (!msg) return
    const chat = global.db.data.chats[msg.chat] || {}
    if (!chat.antiDelete) return

    await this.reply(
      msg.chat,
      `
            ≡ deleted a message 
            ┌─⊷  𝘼𝙉𝙏𝙄 𝘿𝙀𝙇𝙀𝙏𝙀 
            ▢ *Number :* @${participant.split`@`[0]} 
            └─────────────
            `.trim(),
      msg,
      {
        mentions: [participant],
      }
    )
    this.copyNForward(msg.chat, msg, false).catch(e => console.log(e, msg))
  } catch (e) {
    console.error(e)
  }
}

/*
 Polling Update 
*/
export async function pollUpdate(message) {
  for (const { key, update } of message) {
    if (message.pollUpdates) {
      const pollCreation = await this.serializeM(this.loadMessage(key.id))
      if (pollCreation) {
        const pollMessage = await getAggregateVotesInPollMessage({
          message: pollCreation.message,
          pollUpdates: pollCreation.pollUpdates,
        })
        message.pollUpdates[0].vote = pollMessage

        await console.log(pollMessage)
        this.appenTextMessage(
          message,
          message.pollUpdates[0].vote || pollMessage.filter(v => v.voters.length !== 0)[0]?.name,
          message.message
        )
      }
    }
  }
}

/*
Update presence
*/
export async function presenceUpdate(presenceUpdate) {
  const id = presenceUpdate.id
  const nouser = Object.keys(presenceUpdate.presences)
  const status = presenceUpdate.presences[nouser]?.lastKnownPresence
  const user = global.db.data.users[nouser[0]]

  if (user?.afk && status === 'composing' && user.afk > -1) {
    if (user.banned) {
      user.afk = -1
      user.afkReason = 'User Banned Afk'
      return
    }

    await console.log('AFK')
    const username = nouser[0].split('@')[0]
    const timeAfk = new Date() - user.afk
    const caption = `\n@${username} has stopped being AFK and is currently typing.\n\nReason: ${
      user.afkReason ? user.afkReason : 'No Reason'
    }\nFor the past ${timeAfk.toTimeString()}.\n`

    this.reply(id, caption, null, {
      mentions: this.parseMention(caption),
    })
    user.afk = -1
    user.afkReason = ''
  }
}

/**
dfail
 */
global.dfail = (type, m, conn) => {
  const userTag = `@${m.sender.split('@')[0]}`
  const emoji = {
    general: '⚙️',
    owner: '👑',
    moderator: '🛡️',
    premium: '💎',
    group: '👥',
    private: '📱',
    admin: '👤',
    botAdmin: '🤖',
    unreg: '🔒',
    nsfw: '🔞',
    rpg: '🎮',
    restrict: '⛔',
  }

  const msg = {
    owner: `*${emoji.owner} OWNER PRIVILEGE REQUIRED*\n\n${userTag} Access denied. This protocol is reserved for the *Bot Owner*!`,
    moderator: `*${emoji.moderator} MODERATOR CLEARANCE REQUIRED*\n\n${userTag} Authorization failure. *Moderators* only.`,
    premium: `*${emoji.premium} PREMIUM ACCESS REQUIRED*\n\n${userTag} This feature requires *Premium* status. Upgrade your clearance.`,
    group: `*${emoji.group} GROUP PROTOCOL ONLY*\n\n${userTag} This command is restricted to *Group Chats*!`,
    private: `*${emoji.private} PRIVATE CHANNEL ONLY*\n\n${userTag} Shift to a *Private Chat* to execute this.`,
    admin: `*${emoji.admin} ADMIN CLEARANCE REQUIRED*\n\n${userTag} Protocol failure. Only *Group Admins* can trigger this.`,
    botAdmin: `*${emoji.botAdmin} BOT ADMIN RIGHTS REQUIRED*\n\n${userTag} I require *Admin* status to execute this directive!`,
    unreg: `*${emoji.unreg} REGISTRATION REQUIRED*\n\n${userTag} Identity not found in database. Register now:\n\n*#register name.age*`,
    nsfw: `*${emoji.nsfw} CONTENT RESTRICTION*\n\n${userTag} NSFW protocols are offline. Admin activation required.`,
    restrict: `*${persona.messages.restriction}*`,
  }[type]
  if (msg) return m.reply(formatResponse(msg))
}

let file = global.__filename(import.meta.url, true)
watchFile(file, async () => {
  unwatchFile(file)
  console.log(chalk.redBright('Update handler.js'))
  if (global.reloadHandler) console.log(await global.reloadHandler())
})
