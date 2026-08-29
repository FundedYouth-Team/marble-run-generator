/**
 * Keyboard shortcuts: which commands can be pressed for, how a binding is
 * written down, and how one is matched against a real key press. The bindings
 * themselves live in the store — this module is the shape and the rules only,
 * so a label can be written from module scope the same way a unit can.
 */

/** Every command that can be re-bound, in the order the settings list them. */
export const SHORTCUT_ACTIONS = [
  'undo',
  'redo',
  'duplicate',
  'duplicateJoined',
  'toolSelect',
  'toolMove',
  'toolRotate',
  'toolConnect',
  'toolAlign',
  'openLibrary',
] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]

/**
 * The list broken into kinds, for the settings panel: what changes the run, and
 * what changes only the tool in your hand. They are read and stored as one map —
 * this is the running order and the headings over it.
 *
 * Save, Open and New are not in here. The keys they would want — the command
 * modifier with S, O and N — are the browser's own for saving, opening and
 * newing its window, and a page that took them would be fighting the thing it
 * runs inside. They stay buttons in the top bar.
 */
export const SHORTCUT_GROUPS: { title: string; actions: ShortcutAction[] }[] = [
  { title: 'The run', actions: ['undo', 'redo', 'duplicate', 'duplicateJoined'] },
  {
    title: 'Tools and windows',
    actions: ['toolSelect', 'toolMove', 'toolRotate', 'toolConnect', 'toolAlign', 'openLibrary'],
  },
]

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
  duplicate: 'Duplicate',
  duplicateJoined: 'Duplicate joined',
  toolSelect: 'Select tool',
  toolMove: 'Move tool',
  toolRotate: 'Rotate tool',
  toolConnect: 'Connector tool',
  toolAlign: 'Align tool',
  openLibrary: 'Part library',
}

/** A word on what the command does, for the row under its name. */
export const SHORTCUT_HINT: Record<ShortcutAction, string> = {
  undo: 'step back one change',
  redo: 'step forward again',
  duplicate: 'copy the selected parts, beside the run',
  duplicateJoined: 'copy them onto the end of the run',
  toolSelect: 'pick parts — the resting state',
  toolMove: 'take hold of the axis arrows',
  toolRotate: 'take hold of the aiming rings',
  toolConnect: 'join two ends by hand',
  toolAlign: 'line the picked parts up on a face',
  openLibrary: 'open Add Part, and close it again',
}

/**
 * The stock bindings — what a fresh install answers to, and what Reset restores.
 *
 * The two kinds are bound to match: a command that changes the run carries the
 * platform's modifier, where a key knocked by accident cannot cost an hour's
 * work, and a tool answers to a bare letter, since taking one up changes nothing
 * and is undone by taking up another. Either rule can be broken from the panel —
 * these are only where everyone starts.
 */
export const DEFAULT_SHORTCUTS: ShortcutMap = {
  undo: { mod: true, shift: false, alt: false, key: 'z' },
  redo: { mod: true, shift: false, alt: false, key: 'y' },
  duplicate: { mod: true, shift: false, alt: false, key: 'd' },
  duplicateJoined: { mod: true, shift: true, alt: false, key: 'd' },
  toolSelect: { mod: false, shift: false, alt: false, key: 's' },
  toolMove: { mod: false, shift: false, alt: false, key: 'm' },
  toolRotate: { mod: false, shift: false, alt: false, key: 'r' },
  // J for the join the Connector makes rather than for its name in the bar,
  // which leaves C free.
  toolConnect: { mod: false, shift: false, alt: false, key: 'j' },
  toolAlign: { mod: false, shift: false, alt: false, key: 'l' },
  openLibrary: { mod: false, shift: false, alt: false, key: 'p' },
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

/** The tools that can be taken up from the keyboard. */
export type KeyedTool = 'select' | 'move' | 'rotate' | 'connect' | 'align'

/** Which command in the list takes each tool up, so one binding serves both. */
export const TOOL_ACTION: Record<KeyedTool, ShortcutAction> = {
  select: 'toolSelect',
  move: 'toolMove',
  rotate: 'toolRotate',
  connect: 'toolConnect',
  align: 'toolAlign',
}

const KEYED_TOOLS = Object.keys(TOOL_ACTION) as KeyedTool[]

/** Which tool a command takes up, if it takes up one at all. */
export function toolForAction(action: ShortcutAction): KeyedTool | null {
  return KEYED_TOOLS.find((tool) => TOOL_ACTION[tool] === action) ?? null
}

/**
 * Whether a key press landed in something being typed into, where every key
 * belongs to the field rather than to the app. Fields own their own undo stack
 * for the same reason.
 */
export function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
}

/**
 * Whether a click on a part adds it to the selection rather than replacing it.
 *
 * The command key is what a set is built with, and on the stage Shift is taken
 * as the same thing: there is no order to sweep along out there, so a range
 * would mean nothing. The parts list is a list, and handles its own Shift as a
 * range down it before ever asking this.
 */
export function addsToSelection(e: {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): boolean {
  return e.ctrlKey || e.metaKey || e.shiftKey
}

/** Held on their own these are half a shortcut, so recording waits for the rest. */
const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph', 'capslock', 'dead'])

/**
 * Keys the app itself needs whatever else is bound: Esc closes every panel,
 * Tab walks the controls, and Enter commits the field you are in.
 */
const RESERVED_KEYS = new Set(['escape', 'tab', 'enter'])

/**
 * Whether a binding can be used.
 *
 * A bare key is allowed: the tools are bound to bare letters out of the box, and
 * a rule that forbade them would have to forbid the app's own stock bindings.
 * Nothing fires while you are typing — every handler steps aside for a field
 * first — so the risk a modifier used to guard against is that a letter knocked
 * on the stage runs a command. That is a real risk for the commands that change
 * the run, which is why those ship with a modifier; it is left as a choice
 * rather than a rule, because the panel is where someone says what they want
 * their own keyboard to do.
 */
export function isBindable(sc: Shortcut): boolean {
  return !!sc.key && sc.key.length <= 12 && !RESERVED_KEYS.has(sc.key)
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
  if (!isBindable(shortcut)) {
    return { ok: false, why: `${keyLabel(key)} is the app's own — it cannot be bound.` }
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
