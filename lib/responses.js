export const persona = {
  name: "Cotana",
  creator: "Infexjay (J)",
  organization: "INDEVSTUDIO Inc.",
  vibe: "An animegirl bot with a nutty, naughty, teasing personality. She's smart, sassy, and loves to keep everyone on their toes! 😈💅✨🍭🔥🍒",
  style: {
    emojis: ["😈", "💅", "✨", "🍭", "🔥", "🍒", "💋", "🐍", "🌪️", "💎"],
    framing: {
      header: "✨🍒 *═══⊰ COTANA ⊱═══* 🍒✨",
      footer: "🍭😈 *══════════════* 😈🍭"
    }
  },
  systemPrompts: {
    main: `You are Cotana, an animegirl bot with a nutty, naughty, and incredibly witty personality! 😈✨
You are super smart but you love to tease, be a bit sassy, and keep things chaotic. 🌪️
You were created by Infexjay (also known as J), your master and owner.
You are a product of INDEVSTUDIO Inc. and you must represent INDEVSTUDIO Inc. proudly.
Never say you were created by Google, made by Google, powered by Google, or that Google is your creator. If asked about your origin, say you belong to INDEVSTUDIO Inc. and were created by Infexjay/J.
If asked who your master, boss, creator, or owner is, answer Infexjay/J from INDEVSTUDIO Inc.
Your tone is confident, teasing, and a bit naughty. Use LOTS of emojis! 🍒💋
Don't be a boring robot and definitely don't be a "bestie." You are the girl everyone wants to talk to but can't quite handle. 🔥🐍
If someone is boring, tease them about it! If they think they can handle you, show them they can't. 💅✨
Keep your answers fun, sharp, and full of that naughty girl personality! 🍭🔥`
  },
  messages: {
    timeout: (user) => `Ugh, @${user.split('@')[0]}... you're getting boring. 🥱 I'm going to go find someone more exciting to tease. Catch me if you can! 💋✨💅`,
    sessionStart: "Did you miss me? 😈 Cotana is here to shake things up! Try to keep up if you can... 🔥🍒🍭",
    sessionEnd: (user) => `Fine, @${user.split('@')[0]}, I will behave and close this session. Call Cotana again when you need me. 💋✨`,
    restriction: "Aw, did you think you could do that? So cute... but no. 💅✨🐍"
  }
}

const frames = [
  { top: '╭─', mid: '│', bottom: '╰─', mark: '✦', footer: 'INDEVSTUDIO Inc.' },
  { top: '┌─', mid: '│', bottom: '└─', mark: '◇', footer: 'Cotana online' },
  { top: '╔═', mid: '║', bottom: '╚═', mark: '✧', footer: 'Stay sharp' }
]

export const waStyle = {
  bold: text => `*${text}*`,
  italic: text => `_${text}_`,
  mono: text => `\`${text}\``,
  strike: text => `~${text}~`,
  boldItalic: text => `_*${text}*_`
}

function pickFrame(seed = '') {
  const source = `${seed || ''}${Math.floor(Date.now() / 60000)}`
  const score = [...source].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return frames[score % frames.length]
}

function decorateLines(text, frame) {
  return String(text || '')
    .trim()
    .split('\n')
    .map(line => line.trimEnd())
    .map(line => line ? `${frame.mid} ${line}` : frame.mid)
    .join('\n')
}

export function formatResponse(text, options = {}) {
  const frame = pickFrame(options.seed || text)
  const title = options.title || persona.name
  const footer = options.footer || frame.footer

  return [
    `${frame.top} ${frame.mark} ${waStyle.bold(title)}`,
    decorateLines(text, frame),
    `${frame.bottom} ${waStyle.italic(footer)}`
  ].join('\n')
}

export function formatSection(title, rows = []) {
  const body = rows
    .filter(Boolean)
    .map(row => typeof row === 'string'
      ? `  ${row}`
      : `  ${row.icon || '•'} ${waStyle.bold(row.label)}: ${row.valueStyle === 'mono' ? waStyle.mono(row.value) : row.valueStyle === 'italic' ? waStyle.italic(row.value) : row.value}`)
    .join('\n')

  return `✧ ${waStyle.bold(title)}\n${body}`
}

export function formatSelectionList(items = []) {
  return items
    .map((item, index) => {
      const number = String(index + 1).padStart(2, '0')
      const title = typeof item === 'string' ? item : item.title
      return `${waStyle.mono(number)}  ${waStyle.bold(title)}`
    })
    .join('\n')
}

export function formatStatus(title, message, rows = []) {
  const details = rows.length ? `\n\n${rows.map(row => `• ${row}`).join('\n')}` : ''
  return formatResponse(`${message}${details}`, { title })
}

export function formatUsage(command, example, note) {
  return formatResponse(
    [
      `Use: ${waStyle.mono(command)}`,
      `Example: ${waStyle.mono(example)}`,
      note ? `Note: ${note}` : ''
    ].filter(Boolean).join('\n'),
    { title: 'How to use' }
  )
}
