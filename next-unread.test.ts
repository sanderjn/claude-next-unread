import { expect, mock, test } from 'claude-code/testing'

const HOME = '/home/me'
const SELF = 'local_self'
const OTHER = 'local_other'
const MARKERS = `${HOME}/.claude/next-unread/org`
const SESSIONS = `${HOME}/Library/Application Support/Claude/claude-code-sessions/account/org`
const HOST = {
  HOME,
  CLAUDE_CODE_HOST_SESSION_ID: SELF,
  CLAUDE_CODE_ACCOUNT_UUID: 'account',
  CLAUDE_CODE_ORGANIZATION_UUID: 'org',
}
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 80,
  scroll: { offset: 0 },
  view: {},
}

const host = (on, { files = {}, env = HOST, isOnScreen = false } = {}) => {
  const disk: Record<string, string> = { ...files }
  const runs: string[][] = []
  const clock = mock.clock(on, { now: 5000 })

  mock.env(on, env)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.edit', (_, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  on('mcp.call', () => ({
    value: {
      content: [{ type: 'text', text: JSON.stringify({ this_session: { on_screen: isOnScreen } }) }],
      isError: false,
    },
  }))
  on('fs.list', (_, e) => ({
    value: Object.keys(disk)
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({
        name: path.slice(e.path.length + 1),
        kind: 'file',
        size: disk[path].length,
        mtimeMs: 0,
        isLink: false,
      })),
  }))
  on('fs.exists', (_, e) => ({ value: e.path in disk }))
  on('fs.read', (_, e) => (e.path in disk ? { value: disk[e.path] } : { deny: `no such file: ${e.path}` }))
  on('fs.write', (_, e) => {
    disk[e.path] = e.text

    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push([...e.argv])

    if (e.argv[0] === 'rm') {
      delete disk[e.argv[2]]
    }

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })

  return { disk, runs, clock }
}

const waiting = (at: number, lastFocusedAt: number, kind = 'done') => ({
  [`${MARKERS}/${OTHER}.json`]: JSON.stringify({ at, kind }),
  [`${SESSIONS}/${OTHER}.json`]: JSON.stringify({ title: 'Fix the invoices', lastFocusedAt }),
})

const start = $ => $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band names the unread thread and its button jumps there`, async ($, on) => {
    const { disk, runs } = host(on, { files: waiting(2000, 1000) })
    await start($)

    const ui = await $.ui.mount({ plugin: 'next-unread', surface, component: 'AbovePrompt', props: BAND })
    expect(ui.find({ text: 'Fix the invoices finished' })).toBeTruthy()

    await ui.press({ key: 'jump' })
    expect(runs).toContainEqual(['open', `claude://claude.ai/epitaxy/${OTHER}`])
    expect(disk[`${MARKERS}/${OTHER}.json`]).toBeUndefined()
  })
}

const type = ($, text: string, inputText: string) =>
  $.prompt.edit({
    origin: { kind: 'composer' },
    text,
    cursor: text.length,
    start: text.length,
    end: text.length,
    inputText,
  })

test('Option+L jumps from any prompt box and leaves the draft alone', async ($, on) => {
  const { runs } = host(on, { files: waiting(2000, 1000, 'question') })
  await start($)

  expect((await type($, 'take ', '¬')).text).toBe('take ')
  expect(runs).toContainEqual(['open', `claude://claude.ai/epitaxy/${OTHER}`])
})

test('Option+L types nothing when no thread is unread', async ($, on) => {
  const { runs } = host(on)
  await start($)

  expect((await type($, 'take ', '¬')).text).toBe('take ')
  expect(runs.some(argv => argv[0] === 'open')).toBe(false)
})

test('a digit as the key jumps from an empty prompt box only', { options: { key: '0' } }, async ($, on) => {
  const { runs } = host(on, { files: waiting(2000, 1000) })
  await start($)

  expect((await type($, 'take ', '0')).text).toBe('take 0')
  expect(runs.some(argv => argv[0] === 'open')).toBe(false)

  expect((await type($, '', '0')).text).toBe('')
  expect(runs).toContainEqual(['open', `claude://claude.ai/epitaxy/${OTHER}`])
})

test('a thread opened since it finished is no longer unread', async ($, on) => {
  const { disk } = host(on, { files: waiting(2000, 3000) })
  await start($)

  const answer = await $.command.run({ command: 'next-unread', args: '' })
  expect(answer.text).toBe('No unread threads.')
  expect(disk[`${MARKERS}/${OTHER}.json`]).toBeUndefined()
})

test('a turn that ends off screen leaves a marker, and the next turn takes it away', async ($, on) => {
  const { disk } = host(on)
  await start($)

  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(JSON.parse(disk[`${MARKERS}/${SELF}.json`])).toEqual({ at: 5000, kind: 'done' })

  await $.turn.start({ text: 'next', turnId: 't2' })
  expect(disk[`${MARKERS}/${SELF}.json`]).toBeUndefined()
})

test('a turn that ends on screen leaves no marker', async ($, on) => {
  const { disk } = host(on, { isOnScreen: true })
  await start($)

  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(disk[`${MARKERS}/${SELF}.json`]).toBeUndefined()
})

test('outside the desktop app it does nothing', async ($, on) => {
  const { disk, runs } = host(on, { env: { HOME } })
  await start($)

  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(Object.keys(disk)).toEqual([])
  expect(runs).toEqual([])
})
