# next-unread

Conductor-style unread threads for the Claude desktop app.

When a thread in the Code tab finishes its turn or asks you a question while you are looking at another thread, every other thread shows a notice above the prompt box:

```
● Fix the invoices finished (+2 more)   [ Next unread ⌥L ]
```

Press `⌥L` (Option+L) to jump to the oldest unread thread. Your half-typed message stays where it is.

## Requirements

- macOS
- The Claude desktop app, Code tab
- A Claude Code version that supports mods (plugins with a hooks module). Built and tested on 2.1.293.

## Install

Type this at the prompt of a `claude` session in a terminal. The command is not available in the desktop app's own Code tab, but a mod installed at user scope loads there too.

```
/plugin install next-unread --marketplace sanderjn/claude-next-unread
```

Answer `y` to add the marketplace and pick the user scope. Threads that are already open pick the mod up after `/reload-plugins`; new threads load it by themselves.

## Use

| | |
| --- | --- |
| `⌥L` | Jump to the oldest unread thread, from any prompt box |
| **Next unread** button | Same, with the mouse |
| `/next-unread` | Same, as a slash command |

A thread counts as unread when its turn ended, or it asked a question, while it was not on screen. It stops being unread when you open it, jump to it, or send it a new prompt.

## Changing the key

The mod has one option, `key`: the character that triggers the jump when it is typed in the prompt box. The default is `¬`, which is what `⌥L` types on a US or Dutch Mac keyboard. On other layouts `⌥L` types something else (`@` on a German keyboard), so set `key` to the character your preferred Option combination produces.

A letter or digit works too, but only jumps from an empty prompt box, because otherwise you could not type it. An empty `key` turns the shortcut off.

A mod cannot bind `⌘` combinations, and the shortcut only works while the prompt box has focus.

## How it works

Each thread runs its own copy of the mod. When a turn ends off screen, the thread writes a small marker file to `~/.claude/next-unread/`. Every thread checks that folder once a second, compares the markers with the app's own session files to drop threads you have opened since, and draws the notice. The jump opens the thread through the app's `claude://` link.

## Limitations

- It reads the desktop app's session files and uses its deep links. Neither is a documented interface, so an app update can break the mod.
- A thread waiting on a permission prompt does not count as unread.
- The jump is as fast as the app opens a thread from a link. The mod has no quicker way in.
- macOS only. Elsewhere the mod loads and does nothing.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
