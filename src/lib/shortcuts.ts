/**
 * Keyboard shortcuts: which commands can be pressed for, how a binding is
 * written down, and how one is matched against a real key press. The bindings
 * themselves live in the store — this module is the shape and the rules only,
 * so a label can be written from module scope the same way a unit can.
 */

/** Every command that can be re-bound, in the order the settings list them. */
export const SHORTCUT_ACTIONS = ['undo', 'redo', 'duplicate'] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

/**
 * One binding. `mod` is the platform's command modifier — Ctrl on Windows and
 * Linux, ⌘ on a Mac — held as one flag rather than two, so a run saved on one
 * machine reads the way its owner expects on the other.
 */
export interface Shortcut {
  mod: boolean
  shift: boolean
  alt: boolean
  /** `KeyboardEvent.key`, lowercased: `z`, `f2`, `arrowup`. */
  key: string
}

export type ShortcutMap = Record<ShortcutAction, Shortcut>

/** What each command is called in the settings and the help sheet. */
export const SHORTCUT_LABEL: Record<ShortcutAction, string> = {
  undo: 'Undo',
  redo: 'Redo',
  duplicate: 'Duplicate part',
}

/** A word on what the command does, for the row under its name. */
export const SHORTCUT_HINT: Record<ShortcutAction, string> = {
  undo: 'step back one change',
  redo: 'step forward again',
  duplicate: 'copy the selected part',
}

/** The stock bindings — what a fresh install answers to, and what Reset restores. */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  undo: { mod: true, shift: false, alt: false, key: 'z' },
  redo: { mod: true, shift: false, alt: false, key: 'y' },
  duplicate: { mod: true, shift: false, alt: false, key: 'd' },
}

/**
 * Whether this is a Mac, which is the only thing the platform changes here: the
 * command modifier is drawn as ⌘ rather than Ctrl. `navigator.platform` is
 * deprecated but still the most reliable of a bad set, so the user agent backs
 * it up rather than replacing it.
 */
function onMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(`${navigator.platform ?? ''} ${navigator.userAgent}`)
}

export const IS_MAC = onMac()

/** How the command modifier is written on this machine. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'
const ALT_LABEL = IS_MAC ? '⌥' : 'Alt'

/** Keys whose `KeyboardEvent.key` is a word or a space rather than the glyph. */
const KEY_LABEL: Record<string, string> = {
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  delete: 'Del',
  backspace: '⌫',
  enter: 'Enter',
  tab: 'Tab',
}

function keyLabel(key: string): string {
  if (KEY_LABEL[key]) return KEY_LABEL[key]
  // A letter or digit reads as a key cap in upper case; F2 and the like are
  // already words, so only the first letter is lifted.
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1)
}

/** The binding split into caps, so each part can be drawn as its own key. */
export function shortcutParts(sc: Shortcut): string[] {
  return [
    ...(sc.mod ? [MOD_LABEL] : []),
    ...(sc.alt ? [ALT_LABEL] : []),
    ...(sc.shift ? ['Shift'] : []),
    keyLabel(sc.key),
  ]
}

/** The binding on one line — "Ctrl + Z", "⌘ + Shift + D". */
export function formatShortcut(sc: Shortcut): string {
  return shortcutParts(sc).join(' + ')
}

export function sameShortcut(a: Shortcut, b: Shortcut): boolean {
  return a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && a.key === b.key
}

export function sameShortcuts(a: ShortcutMap, b: ShortcutMap): boolean {
  return SHORTCUT_ACTIONS.every((action) => sameShortcut(a[action], b[action]))
}

/**
 * Whether a key press is this binding. Ctrl and ⌘ are read as the one modifier
 * they stand for, so a binding written on a Mac still answers to Ctrl and one
 * written on Windows still answers to ⌘ — nothing else in the app uses either
 * on its own, and it saves a puzzled user on a borrowed keyboard.
 */
export function matchesShortcut(e: KeyboardEvent, sc: Shortcut): boolean {
  return (
    (e.ctrlKey || e.metaKey) === sc.mod &&
    e.shiftKey === sc.shift &&
    e.altKey === sc.alt &&
    e.key.toLowerCase() === sc.key
  )
}

/** Which command a key press is, if it is any of them. */
export function actionFor(e: KeyboardEvent, map: ShortcutMap): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((action) => matchesShortcut(e, map[action])) ?? null
}

/** Held on their own these are half a shortcut, so recording waits for the rest. */
const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph', 'capslock', 'dead'])

/**
 * Keys the app itself needs whatever else is bound: Esc closes every panel,
 * Tab walks the controls, and Enter commits the field you are in.
 */
const RESERVED_KEYS = new Set(['escape', 'tab', 'enter'])

/** F1–F12 stand alone; every other key needs a modifier in front of it. */
const FUNCTION_KEY = /^f([1-9]|1[0-2])$/

export function isBindable(sc: Shortcut): boolean {
  if (!sc.key || sc.key.length > 12 || RESERVED_KEYS.has(sc.key)) return false
  // A bare letter would fire the moment the stage has focus, so a modifier is
  // asked for — except on the function keys, which are nothing else's.
  return sc.mod || sc.alt || sc.shift || FUNCTION_KEY.test(sc.key)
}

/**
 * What a key press means while a binding is being recorded: the binding, a
 * reason it cannot be one, or null for "still only modifiers — keep listening".
 */
export type Capture = { ok: true; shortcut: Shortcut } | { ok: false; why: string }

export function captureShortcut(e: KeyboardEvent): Capture | null {
  const key = e.key.toLowerCase()
  if (MODIFIER_KEYS.has(key)) return null
  const shortcut: Shortcut = {
    mod: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key,
  }
  if (RESERVED_KEYS.has(key)) {
    return { ok: false, why: `${keyLabel(key)} is the app's own — it cannot be bound.` }
  }
  if (!isBindable(shortcut)) {
    return {
      ok: false,
      why: `Add ${MOD_LABEL}, ${ALT_LABEL} or Shift — a key on its own would fire as you work.`,
    }
  }
  return { ok: true, shortcut }
}

/** One binding read back off disk or out of storage, or the fallback. */
function readShortcut(raw: unknown, fallback: Shortcut): Shortcut {
  if (!raw || typeof raw !== 'object') return fallback
  const o = raw as Record<string, unknown>
  if (typeof o.key !== 'string') return fallback
  const sc: Shortcut = {
    mod: o.mod === true,
    shift: o.shift === true,
    alt: o.alt === true,
    key: o.key.toLowerCase(),
  }
  // What cannot be set cannot be loaded either: a hand-edited file does not get
  // to bind Esc, or leave a command on a bare letter.
  return isBindable(sc) ? sc : fallback
}

/**
 * A whole set of bindings made safe to use: anything missing or unreadable
 * falls back to the stock key for that command, so one bad entry never leaves a
 * command with no way to reach it.
 */
export function readShortcuts(raw: unknown): ShortcutMap {
  const o = (raw ?? {}) as Record<string, unknown>
  const map = {} as ShortcutMap
  for (const action of SHORTCUT_ACTIONS) {
    map[action] = readShortcut(o[action], DEFAULT_SHORTCUTS[action])
  }
  // Two commands on one key would leave the second unreachable, so a clash
  // hands the later one its stock key back.
  const taken: Shortcut[] = []
  for (const action of SHORTCUT_ACTIONS) {
    if (taken.some((sc) => sameShortcut(sc, map[action]))) map[action] = DEFAULT_SHORTCUTS[action]
    taken.push(map[action])
  }
  return map
}

/** Reads the bindings out of a stored JSON string; junk falls back to the defaults. */
export function parseShortcuts(text: string | null): ShortcutMap {
  if (!text) return { ...DEFAULT_SHORTCUTS }
  try {
    return readShortcuts(JSON.parse(text))
  } catch {
    return { ...DEFAULT_SHORTCUTS }
  }
}
