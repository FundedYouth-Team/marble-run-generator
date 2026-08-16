/**
 * View-control glyphs, shared so the 2D draft and the 3D stage label the same
 * action with the same picture.
 */

/** Roof over a doorway — "back to the starting view". */
export function HomeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.4 10.9 12 3.6l8.6 7.3" />
      <path d="M5.6 9.8V20h12.8V9.8" />
      <path d="M9.6 20v-5.6h4.8V20" />
    </svg>
  )
}

/** Arrow curling back on itself — "step back". */
export function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

/** The undo arrow, mirrored — "step forward again". */
export function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </svg>
  )
}

/** Corner brackets closing in on the run — "frame what is there". */
export function FitIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 8.4V3.6h4.8M15.6 3.6h4.8v4.8M20.4 15.6v4.8h-4.8M8.4 20.4H3.6v-4.8" />
      <path d="M12 8.8 15.2 12 12 15.2 8.8 12z" />
    </svg>
  )
}
