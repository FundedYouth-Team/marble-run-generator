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

/**
 * The three axis arrows every CAD move gizmo wears, in the colours they are
 * always drawn in: X red, Y green, Z blue. Coloured rather than currentColor on
 * purpose — the point of the picture is that it is the handle you see on stage.
 */
export function MoveIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* Up is +Y, right is +X, and towards the viewer — down-left — is +Z. */}
      <g stroke="#3fb950">
        <path d="M12 13.4V3.9" />
        <path d="M9.4 6.4 12 3.4l2.6 3" />
      </g>
      <g stroke="#e5534b">
        <path d="M12.6 13.4h8.1" />
        <path d="M18.2 10.9l3 2.6-3 2.6" />
      </g>
      <g stroke="#4d9cf5">
        <path d="M11.4 14 5.6 19.2" />
        <path d="M4 15.9 5.2 19.7l3.9-.6" />
      </g>
      <circle cx="12" cy="13.4" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * A ring turning about the upright — "swing this round". Green like the Y arrow
 * of {@link MoveIcon}, because the ring on stage is the green one: a run is set
 * down on a heading, and its climbs and corners belong to the parts themselves,
 * so the vertical is the only axis there is anything to turn about.
 */
export function RotateIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* The axis it turns about, drawn faint so the ring stays the subject. */}
      <path d="M12 3.4v17.2" stroke="currentColor" opacity="0.45" />
      <g stroke="#3fb950">
        {/* Left of the ring, the long way round under it, up to the top. */}
        <path d="M4.6 12.6a7.4 4.3 0 1 0 7.4-4.3" />
        <path d="M14.5 6.7 12 8.3l2.5 1.6" />
      </g>
      <circle cx="12" cy="12.6" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Two links closed on each other — "bond these two ends together". */
export function ConnectIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.6 14.4 14.4 9.6" />
      <path d="M13 6.6l1.6-1.6a3.4 3.4 0 0 1 4.8 4.8L17.8 11.4" />
      <path d="M11 17.4 9.4 19a3.4 3.4 0 0 1-4.8-4.8L6.2 12.6" />
    </svg>
  )
}

/** The same links pulled apart, with the break shown — "take this joint open". */
export function DisconnectIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.4 6.2l1.2-1.2a3.4 3.4 0 0 1 4.8 4.8L18.2 11" />
      <path d="M10.6 17.8 9.4 19a3.4 3.4 0 0 1-4.8-4.8L5.8 13" />
      <path d="M20.4 14.6h-2.6M6.2 9.4H3.6M15.6 18.8v-2.4M8.4 7.6V5.2" />
    </svg>
  )
}

/** Mouse arrow with its tail — "back to picking parts". */
export function SelectIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3.2 17.6 9.6l-5.4 1.6-1.6 5.4z" />
      <path d="M12.6 12.6 19 19" />
    </svg>
  )
}

/**
 * A part falling onto the plane it comes to rest on — "set this run down on the
 * workplane". The arrow is the only thing that moves in the picture, and it only
 * moves down: that is the whole of what the tool does.
 */
export function DropToPlaneIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.6v5.2" />
      <path d="m9.3 5.2 2.7 2.6 2.7-2.6" />
      {/* Faintly filled, so it reads as the part rather than as another frame. */}
      <rect x="6.7" y="9.9" width="10.6" height="6.5" rx="1.4" fill="currentColor" fillOpacity="0.16" />
      {/* The workplane, on its stand — the datum the part lands on. */}
      <path d="M3.2 18.4h17.6" />
      <path d="M6.2 18.4v2.6M17.8 18.4v2.6" />
    </svg>
  )
}

/**
 * One part with a copy of itself set down behind it — "make another of these".
 * The copy is the one in front and faintly filled, because that is the part the
 * click leaves you holding.
 */
export function DuplicateIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* The original, behind — drawn as the three sides that stay visible. */}
      <path d="M16.4 8.4V5.2a1.6 1.6 0 0 0-1.6-1.6H5.2a1.6 1.6 0 0 0-1.6 1.6v9.6a1.6 1.6 0 0 0 1.6 1.6h3.2" />
      <rect x="8.4" y="8.4" width="12" height="12" rx="1.6" fill="currentColor" fillOpacity="0.16" />
    </svg>
  )
}

/**
 * The same copy, with an arrow carrying it onto the end of the run — "make
 * another of these and join it on". The bar is the end it lands against, which
 * is what separates this from a copy that is merely nudged aside.
 */
export function DuplicateJoinIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* The original, behind — drawn as the three sides that stay visible. */}
      <path d="M12.2 6.2V4.1a1.4 1.4 0 0 0-1.4-1.4H3.4A1.4 1.4 0 0 0 2 4.1v7.4a1.4 1.4 0 0 0 1.4 1.4h2" />
      <rect x="5.6" y="6.2" width="8.4" height="8.4" rx="1.4" fill="currentColor" fillOpacity="0.16" />
      {/* Onto the run: the way the copy travels, and the end it meets. */}
      <path d="M15.4 10.4h3.4" />
      <path d="m17 8.4 2 2-2 2" />
      <path d="M21.4 6.6v7.6" />
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
