export type Unread = {
  sessionId: string
  title: string
  at: number
  kind: 'done' | 'question'
}

declare module 'claude-code' {
  interface PluginState {
    'next-unread': { unread: Unread[] }
  }
}
