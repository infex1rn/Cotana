import crypto from 'crypto'
import { formatResponse } from '../lib/responses.js'

const commandList = [
  'calc <expression>',
  'uuid',
  'password [length]',
  'coinflip',
  'roll [sides]',
  'choose <a | b | c>',
  'reverse <text>',
  'uppercase <text>',
  'lowercase <text>',
  'titlecase <text>',
  'wordcount <text>',
  'charcount <text>',
  'base64enc <text>',
  'base64dec <text>',
  'urlenc <text>',
  'urldec <text>',
  'jsonfmt <json>',
  'timestamp',
  'date',
  'remindformat'
]

const safeCalcPattern = /^[\d\s+\-*/%().,]+$/

function requireText(text, usedPrefix, command, example) {
  if (text?.trim()) return text.trim()
  throw `Usage: *${usedPrefix}${command}* ${example}`
}

function titleCase(text) {
  return text.toLowerCase().replace(/\b\p{L}/gu, char => char.toUpperCase())
}

function randomPassword(length = 16) {
  const safeLength = Math.min(Math.max(Number.parseInt(length, 10) || 16, 8), 64)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?'
  const bytes = crypto.randomBytes(safeLength)
  return Array.from(bytes, byte => chars[byte % chars.length]).join('')
}

let handler = async (m, { text, usedPrefix, command }) => {
  const input = text?.trim() || ''

  switch (command) {
    case 'calc': {
      const expression = requireText(input, usedPrefix, command, '2 + 2 * 5')
      if (!safeCalcPattern.test(expression)) throw 'Only numbers and math operators are allowed.'
      const normalized = expression.replace(/,/g, '')
      const result = Function(`"use strict"; return (${normalized})`)()
      if (!Number.isFinite(result)) throw 'That calculation did not return a finite number.'
      return m.reply(formatResponse(`🧮 *Calculator*\n${expression} = *${result}*`))
    }
    case 'uuid':
      return m.reply(formatResponse(`🆔 *UUID*\n${crypto.randomUUID()}`))
    case 'password':
      return m.reply(formatResponse(`🔐 *Password*\n${randomPassword(input)}`))
    case 'coinflip':
      return m.reply(formatResponse(`🪙 *Coin Flip*\n${Math.random() < 0.5 ? 'Heads' : 'Tails'}`))
    case 'roll': {
      const sides = Math.min(Math.max(Number.parseInt(input, 10) || 6, 2), 1000000)
      return m.reply(formatResponse(`🎲 *D${sides} Roll*\n${crypto.randomInt(1, sides + 1)}`))
    }
    case 'choose': {
      const choices = input.split(/[|,]/).map(choice => choice.trim()).filter(Boolean)
      if (choices.length < 2) throw `Usage: *${usedPrefix}${command}* pizza | rice | pasta`
      return m.reply(formatResponse(`🎯 *Choice*\n${choices[crypto.randomInt(choices.length)]}`))
    }
    case 'reverse':
      return m.reply(formatResponse([...requireText(input, usedPrefix, command, 'hello')].reverse().join('')))
    case 'uppercase':
      return m.reply(formatResponse(requireText(input, usedPrefix, command, 'hello').toUpperCase()))
    case 'lowercase':
      return m.reply(formatResponse(requireText(input, usedPrefix, command, 'HELLO').toLowerCase()))
    case 'titlecase':
      return m.reply(formatResponse(titleCase(requireText(input, usedPrefix, command, 'hello world'))))
    case 'wordcount': {
      const words = requireText(input, usedPrefix, command, 'count these words').split(/\s+/).filter(Boolean)
      return m.reply(formatResponse(`📝 *Word Count*\n${words.length}`))
    }
    case 'charcount':
      return m.reply(formatResponse(`🔢 *Character Count*\n${[...requireText(input, usedPrefix, command, 'count me')].length}`))
    case 'base64enc':
      return m.reply(formatResponse(Buffer.from(requireText(input, usedPrefix, command, 'hello')).toString('base64')))
    case 'base64dec':
      return m.reply(formatResponse(Buffer.from(requireText(input, usedPrefix, command, 'aGVsbG8='), 'base64').toString('utf8')))
    case 'urlenc':
      return m.reply(formatResponse(encodeURIComponent(requireText(input, usedPrefix, command, 'hello world'))))
    case 'urldec':
      return m.reply(formatResponse(decodeURIComponent(requireText(input, usedPrefix, command, 'hello%20world'))))
    case 'jsonfmt': {
      const parsed = JSON.parse(requireText(input, usedPrefix, command, '{"hello":"world"}'))
      return m.reply('```json\n' + JSON.stringify(parsed, null, 2) + '\n```')
    }
    case 'timestamp':
      return m.reply(formatResponse(`⏱️ *Timestamp*\nUnix: ${Math.floor(Date.now() / 1000)}\nISO: ${new Date().toISOString()}`))
    case 'date':
      return m.reply(formatResponse(`📅 *Date*\n${new Date().toUTCString()}`))
    case 'remindformat':
      return m.reply(formatResponse(`⏰ *Reminder Format*\nUse clear text like:\n• ${usedPrefix}remind me in 10 minutes to drink water\n• ${usedPrefix}remind me tomorrow 9am to call mum`))
  }
}

handler.help = commandList
handler.tags = ['tools']
handler.command = [
  'calc', 'uuid', 'password', 'coinflip', 'roll', 'choose', 'reverse',
  'uppercase', 'lowercase', 'titlecase', 'wordcount', 'charcount',
  'base64enc', 'base64dec', 'urlenc', 'urldec', 'jsonfmt', 'timestamp',
  'date', 'remindformat'
]
handler.desc = 'Useful utility commands for calculations, random choices, text conversion, encoding, JSON formatting, and time.'

export default handler
