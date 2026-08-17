/**
 * Shared glyphs, so the same action wears the same picture wherever it is
 * offered — the 2D draft, the 3D stage, the model tree and the right-click menu.
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

/** Open eye — "this part is on stage". */
export function EyeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.9 12S5.4 5.6 12 5.6 22.1 12 22.1 12 18.6 18.4 12 18.4 1.9 12 1.9 12z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  )
}

/** The eye, struck through — "take this part off stage". */
export function EyeOffIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.6 6.1A9.6 9.6 0 0 1 12 5.8c6.6 0 10.1 6.2 10.1 6.2a17 17 0 0 1-3.4 4" />
      <path d="M6.1 7.9A17.4 17.4 0 0 0 1.9 12S5.4 18.2 12 18.2a9.9 9.9 0 0 0 4.1-.85" />
      <path d="M10 10a2.9 2.9 0 0 0 4.1 4.1" />
      <path d="M3.4 3.4 20.6 20.6" />
    </svg>
  )
}

/** Pencil on the page — "give this part your own name". */
export function PencilIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.6 4.6 19.4 9.4" />
      <path d="M17 2.2a2.3 2.3 0 0 1 3.3 3.3L7.5 18.3l-4.4 1.1 1.1-4.4z" />
    </svg>
  )
}

/** Mouse arrow — "make this the part the panels are editing". */
export function PickIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 3.4 19 10.6l-6.2 1.8L10 19z" />
    </svg>
  )
}

/** Waste bin — "take this part out of the run". */
export function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.8 6.2h16.4" />
      <path d="M9.4 6.2V4.4a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.8" />
      <path d="M6.2 6.2 7 19.4a1.4 1.4 0 0 0 1.4 1.3h7.2a1.4 1.4 0 0 0 1.4-1.3l.8-13.2" />
      <path d="M10.4 10v6.6M13.6 10v6.6" />
    </svg>
  )
}
