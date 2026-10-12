import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Unread } from '../types'

type Marker = Pick<Unread, 'at' | 'kind'>
type AppSession = { title?: string; isArchived?: boolean; lastFocusedAt?: number }
type Paths = { id: string; markers: string; sessions: string }

// what Option+L types on a US or Dutch Mac keyboard
const OPTION_L = '¬'
const LINK = 'claude://claude.ai/epitaxy/'
const POLL_MS = 1000
const DOUBLE_PRESS_MS = 400
const NEWEST_FOCUS = `grep -oh '"lastFocusedAt":[0-9]*' "$0"/local_*.json | cut -d: -f2 | sort -n | tail -1`

const unread = atom({ plugin: 'next-unread', key: 'unread' } as const, [])

let paths: Promise<Paths | null> | undefined
let isScanning = false
let lastJumpAt = 0

const resolvePaths = async ($: EngineInterface): Promise<Paths | null> => {
  const id = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
  const home = await $.env.get('HOME')
  const account = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
  const org = await $.env.get('CLAUDE_CODE_ORGANIZATION_UUID')

  if (!id || !home || !account || !org) {
    return null
  }

  return {
    id,
    markers: `${home}/.claude/next-unread/${org}`,
    sessions: `${home}/Library/Application Support/Claude/claude-code-sessions/${account}/${org}`,
  }
}

const locate = ($: EngineInterface) => {
  paths ??= resolvePaths($)

  return paths
}

const json = async <T,>($: EngineInterface, path: string): Promise<T | null> => {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return null
  }
}

const drop = ($: EngineInterface, at: Paths, sessionId: string) =>
  $.process.run(['rm', '-f', `${at.markers}/${sessionId}.json`])

const isNewestFocus = async ($: EngineInterface, at: Paths) => {
  const own = await json<AppSession>($, `${at.sessions}/${at.id}.json`)
  const newest = await $.process.run(['sh', '-c', NEWEST_FOCUS, at.sessions])

  return own?.lastFocusedAt !== undefined && Number(newest.stdout.trim()) === own.lastFocusedAt
}

const isOnScreen = async ($: EngineInterface, at: Paths) => {
  try {
    const answer = await $.mcp.call('ccd_window', 'get_window_layout')
    const layout =
      answer.structuredContent ?? JSON.parse(answer.content.map(block => block.text ?? '').join(''))
    const shown = (layout as { this_session?: { on_screen?: unknown } }).this_session?.on_screen

    if (!answer.isError && typeof shown === 'boolean') {
      return shown
    }
  } catch {
    // the app's window server is not reachable from every host
  }

  return isNewestFocus($, at)
}

const flag = async ($: EngineInterface, kind: Marker['kind']) => {
  try {
    const at = await locate($)

    if (at === null || (await isOnScreen($, at))) {
      return
    }

    const marker: Marker = { at: await $.clock.now(), kind }
    await $.fs.write(`${at.markers}/${at.id}.json`, JSON.stringify(marker))
  } catch {
    // bookkeeping never gets in the way of the turn
  }
}

const clear = async ($: EngineInterface) => {
  try {
    const at = await locate($)

    if (at !== null) {
      await drop($, at, at.id)
    }
  } catch {
    // bookkeeping never gets in the way of the turn
  }
}

const scan = async ($: EngineInterface, at: Paths) => {
  const entries = await $.fs.list(at.markers).catch(() => [])
  const found: Unread[] = []

  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) {
      continue
    }

    const sessionId = entry.name.slice(0, -'.json'.length)
    const appFile = `${at.sessions}/${sessionId}.json`
    const marker = await json<Marker>($, `${at.markers}/${entry.name}`)
    const app = await json<AppSession>($, appFile)

    if (marker === null || (app === null && (await $.fs.exists(appFile)))) {
      continue
    }

    if (app === null || app.isArchived || (app.lastFocusedAt ?? 0) > marker.at) {
      await drop($, at, sessionId)
      continue
    }

    if (sessionId !== at.id) {
      found.push({ sessionId, title: app.title || 'Untitled', at: marker.at, kind: marker.kind })
    }
  }

  return found.sort((a, b) => a.at - b.at)
}

const refresh = async ($: EngineInterface) => {
  const at = await locate($)

  if (at === null || isScanning) {
    return
  }

  isScanning = true

  try {
    const found = await scan($, at)

    if (JSON.stringify(found) !== JSON.stringify(await read($, unread))) {
      await update($, unread, () => found)
    }
  } finally {
    isScanning = false
  }
}

const jump = async ($: EngineInterface) => {
  const at = await locate($)
  const [target] = await read($, unread)

  if (at === null || target === undefined) {
    return null
  }

  const now = await $.clock.now()

  // the band button's own hotkey and the prompt box can both report one press
  if (now - lastJumpAt < DOUBLE_PRESS_MS) {
    return target
  }

  lastJumpAt = now
  await $.process.run(['open', `${LINK}${target.sessionId}`])
  await update($, unread, list => list.filter(one => one.sessionId !== target.sessionId))
  await drop($, at, target.sessionId)

  return target
}

export const register: Register = (on, options) => {
  const key = typeof options.key === 'string' ? options.key : OPTION_L
  const isTypable = /^[0-9a-z]$/i.test(key)
  const hotkey = /^[0-9a-z]$/.test(key) ? key : undefined
  const hint = key === OPTION_L ? ' ⌥L' : key === '' ? '' : ` (${key})`

  on('session.start', async ($, e, next) => {
    if ((await locate($)) !== null) {
      await $.command.register({
        name: 'next-unread',
        description: 'Jump to the next unread thread',
      })
      $.clock.every(POLL_MS, () => void refresh($).catch(() => {}))
      await refresh($).catch(() => {})
    }

    return next(e)
  })

  on('command.run', { command: 'next-unread' }, async $ => {
    const target = await jump($)

    return { text: target === null ? 'No unread threads.' : `Jumped to ${target.title}.` }
  })

  on('turn.start', async ($, e, next) => {
    await clear($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason !== 'aborted') {
      await flag($, 'done')
    }

    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await flag($, 'question')

    try {
      return await next(e)
    } finally {
      await clear($)
    }
  })

  on('prompt.edit', async ($, e, next) => {
    if (key === '' || e.inputText !== key || (isTypable && e.text !== '')) {
      return next(e)
    }

    // a letter or digit is typed as usual when nothing is unread; the Option character never is
    if ((await jump($)) === null && isTypable) {
      return next(e)
    }

    return { text: e.text, cursor: e.cursor }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, unread)
    const [first] = list

    if (e.props.hasSurvey || first === undefined) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = list.length > 1 ? ` (+${list.length - 1} more)` : ''
    const what = first.kind === 'question' ? 'has a question' : 'finished'

    return (
      <Box>
        <Text>
          ● {first.title} {what}
          {rest}{' '}
        </Text>
        <Button key="jump" label={`Next unread${hint}`} hotkey={hotkey} variant="primary" onPress={() => jump($)} />
      </Box>
    )
  })
}
