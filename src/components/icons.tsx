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

/** Tick — the mark inside a ticked box, drawn on its own so the box is CSS. */
export function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4.5 12.5 5 5 10-11" />
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
 * A box drawn in isometric with a dimension line struck under it — "how big is
 * this?". The box is the cube the spans are read off, and the rule beneath it,
 * squared off at both ends, is the drafting way of asking a length: the same
 * figure the tool then draws on the stage, shrunk to a button.
 */
export function MeasureIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* The six edges of the box that make its silhouette. */}
      <path d="M12 2.2 20.4 6.6v7.2L12 18.2 3.6 13.8V6.6z" />
      {/* The three that meet at the near corner, which is what makes it a solid. */}
      <path d="M12 9.8 20.4 6.6M12 9.8 3.6 6.6M12 9.8v8.4" />
      {/* The dimension line under it, squared off at both ends. */}
      <path d="M3.6 21.4h16.8M3.6 19.8v3.2M20.4 19.8v3.2" />
    </svg>
  )
}

/**
 * Three parts of different lengths brought flush against one line — "line these
 * up on that".
 *
 * The datum is the upright, drawn full height so it reads as a line the parts
 * have come onto rather than as the edge of the leftmost of them. The three bars
 * are deliberately unequal: three of a length would be a stack of shelves, and
 * it is the ragged far ends that say the alignment is on one face only.
 */
export function AlignIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* The datum. */}
      <path d="M3.6 2.4v19.2" />
      {/* The three, flush on it and ragged off the other end. */}
      <rect x="3.6" y="4.6" width="16.8" height="4" rx="1.2" fill="currentColor" fillOpacity="0.16" />
      <rect x="3.6" y="10.6" width="9.2" height="4" rx="1.2" fill="currentColor" fillOpacity="0.16" />
      <rect x="3.6" y="16.6" width="13.4" height="4" rx="1.2" fill="currentColor" fillOpacity="0.16" />
    </svg>
  )
}

/**
 * One of the nine faces the Align tool offers, drawn rather than named: three
 * parts of different sizes brought flush against a datum, with the datum where
 * that face actually is.
 *
 * A picture says which face far faster than a word does — the whole point of the
 * word "Left" is the picture of it — and nine words across three rows is a wall
 * of text in a strip one line high. So the strip carries these instead, and the
 * words survive on hover and for anything reading the page aloud.
 *
 * The three bars are deliberately unequal, in the same three lengths every time:
 * three of a length would be a stack of shelves, and it is the ragged far ends
 * that say the alignment is on one face only. `mid` has no datum edge to sit
 * against, so its line runs through the middle of the bars instead — which is
 * exactly what centring on a middle does.
 *
 * X and Z share the one form — bars lying across an upright datum — because they
 * are the same operation on two axes, and a plan has no up in it to tell them
 * apart by. What tells them apart is the axis letter beside the row, which is
 * the same thing that tells the two centres apart. Y is the one axis nobody
 * needs telling about, so it gets the form everyone already reads: bars standing
 * on the ground.
 */
export function AlignFaceIcon({
  axis,
  edge,
  size = 15,
}: {
  axis: 'x' | 'y' | 'z'
  edge: 'min' | 'mid' | 'max'
  size?: number
}) {
  // The three parts, and the room the glyph is drawn in.
  const spans = [16.8, 9.2, 13.4]
  const thick = 4
  const lanes = [4.6, 10.6, 16.6]
  const lo = 3.6
  const hi = 20.4
  const mid = 12
  const upright = axis !== 'y'

  const bars = spans.map((span, i) => {
    // Where the bar starts on the axis being aligned: hard against the near
    // datum, hard against the far one, or straddling the middle.
    const at = edge === 'min' ? lo : edge === 'max' ? hi - span : mid - span / 2
    return upright
      ? { x: at, y: lanes[i], width: span, height: thick }
      : // Up the page, where the world's Y runs the other way from the screen's:
        // the bottom face is the far edge of the box, not the near one.
        { x: lanes[i], y: edge === 'min' ? hi - span : edge === 'max' ? lo : mid - span / 2, width: thick, height: span }
  })
  // The datum itself, run the full width of the glyph so it reads as a line the
  // parts have come onto rather than as the edge of the nearest of them. On a
  // middle it runs through them, which is what centring on one looks like.
  const near = edge === 'min' ? lo : edge === 'max' ? hi : mid
  const datum = upright ? near : edge === 'min' ? hi : edge === 'max' ? lo : mid

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx="1.2" fill="currentColor" fillOpacity="0.16" />
      ))}
      {/* Last, so it is drawn over the parts rather than under them: on a middle
          it is a centreline through them, and on the other six it is the face
          they have been brought flush against. Either way it is the thing the
          glyph is about, and must not be the thing half hidden behind a fill. */}
      <path d={upright ? `M${datum} 2.4v19.2` : `M2.4 ${datum}h19.2`} />
    </svg>
  )
}

/**
 * A length of run with two posts standing under it — "prop this up".
 *
 * The tube is the line across the top and the posts are the two uprights, each
 * meeting it in a little cradle. The plate they land on is the rule underneath,
 * which is what makes it read as standing on something rather than as a bracket
 * floating in space.
 */
export function SupportIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {/* The run, falling gently the way a run does. */}
      <path d="M2.6 6.4h18.8" />
      {/* Two posts, each cupping the tube where it meets it. */}
      <path d="M6 19.4v-9a2.4 2.4 0 0 1 2.4-2.4" />
      <path d="M6 8h2.4" />
      <path d="M16.6 19.4v-9a2.4 2.4 0 0 0-2.4-2.4" />
      <path d="M16.6 8h-2.4" />
      {/* The ground they stand on. */}
      <path d="M3 19.4h17" />
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
 * A part copied down a cascade — "make another of these and join it on". Four
 * cards stepping away from the original, which is the filled one at the back:
 * the step is the run growing by a part at a time, which is what separates this
 * from a copy that is merely nudged aside.
 *
 * Each card behind is drawn as the L of it that the next one does not cover, so
 * the cascade reads on any ground without any of them needing a solid fill.
 */
export function DuplicateJoinIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* The original, at the back. Closed and filled, so it reads as the part
          that was already there rather than as one more empty copy. */}
      <path
        d="M5.5 11.1H3.2a1.5 1.5 0 0 1-1.5-1.5V3.2a1.5 1.5 0 0 1 1.5-1.5h6.4a1.5 1.5 0 0 1 1.5 1.5v2.3H5.5Z"
        fill="currentColor"
        fillOpacity="0.16"
      />
      <path d="M9.3 14.9H7a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 7 5.5h6.4A1.5 1.5 0 0 1 14.9 7v2.3" />
      <path d="M13.1 18.7h-2.3a1.5 1.5 0 0 1-1.5-1.5v-6.4a1.5 1.5 0 0 1 1.5-1.5h6.4a1.5 1.5 0 0 1 1.5 1.5v2.3" />
      <rect x="13.1" y="13.1" width="9.4" height="9.4" rx="1.5" />
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

/* ---------------- the left rail's five menus ----------------
   One glyph per menu, all drawn on the same 24 grid at the same weight, so the
   column reads as one row of switches rather than five borrowed pictures. Each
   one is the thing itself seen the way its panel talks about it: the tube down
   the barrel for its size and its style, along its length for a measurement,
   and from the side for the angle it bends through. */

/** Tube down the barrel, bore dimensioned across — "how wide, and how thick". */
export function TubeSizeIcon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* Outside wall and bore — the two circles every tube figure in the app is. */}
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.7" />
      {/* The bore called out across itself, arrowheads inward the way a
          dimension is drawn when it will not fit outside the line. */}
      <path d="M7.3 12h9.4" />
      <path d="m9.4 10.2-1.9 1.8 1.9 1.8M14.6 10.2l1.9 1.8-1.9 1.8" />
    </svg>
  )
}

/** The same barrel with a quarter of its wall gone — "how far round it closes". */
export function TubeStyleIcon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* Three quarters of wall, left open at the top-left corner: the gap is
          the whole of what this menu sets, so it is what the eye lands on. */}
      <path d="M12 3a9 9 0 1 1-9 9" />
      {/* The bore, and the two cut faces the opening ends at. */}
      <circle cx="12" cy="12" r="4.4" />
      <path d="M12 3v4.6M3 12h4.6" />
    </svg>
  )
}

/** Wheel of colour round a bare middle — "what this part is painted". */
export function PartColorIcon({ size = 21 }: { size?: number }) {
  // Six sixths of a wheel, clockwise from the right. Painted rather than drawn
  // in the ink of the rail: a colour control that is itself grey says nothing,
  // and the ring and hub still take `currentColor`, so the button's hover and
  // lit states read on it exactly as they do on the other four.
  const WEDGES: [string, string][] = [
    ['M12 12 21 12 A9 9 0 0 1 16.5 19.79Z', '#e2574c'],
    ['M12 12 16.5 19.79 A9 9 0 0 1 7.5 19.79Z', '#a25bb0'],
    ['M12 12 7.5 19.79 A9 9 0 0 1 3 12Z', '#4173d6'],
    ['M12 12 3 12 A9 9 0 0 1 7.5 4.21Z', '#2a9e35'],
    ['M12 12 7.5 4.21 A9 9 0 0 1 16.5 4.21Z', '#e8b53a'],
    ['M12 12 16.5 4.21 A9 9 0 0 1 21 12Z', '#e08a2e'],
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {WEDGES.map(([d, fill]) => (
        <path key={fill} d={d} fill={fill} stroke="none" />
      ))}
      <circle cx="12" cy="12" r="9" />
      {/* Hub, filled in the panel's own ground so the wedges stop at it. */}
      <circle cx="12" cy="12" r="3.5" fill="var(--panel)" />
    </svg>
  )
}

/** A length of tube from the side, dimensioned end to end — "how long". */
export function MeasurementIcon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* The dimension over the part, witness lines dropped to it at both ends. */}
      <path d="M4 3.6v4.8M20 3.6v4.8" />
      <path d="M4 6h16" />
      <path d="m6.4 4.3-2 1.7 2 1.7M17.6 4.3l2 1.7-2 1.7" />
      {/* The tube itself, ends squared off the way a cut length is. */}
      <rect x="3.2" y="12.4" width="17.6" height="8" rx="4" />
      <path d="M7.2 12.6v7.6" />
    </svg>
  )
}

/** Run broken over a baseline, the break called out — "what angle, and where". */
export function AngleJointIcon({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {/* The level the angle is read against, carried on past the break. */}
      <path d="M2.6 18.4h18.8" strokeWidth="1.3" strokeDasharray="2.4 2.6" opacity="0.6" />
      {/* The run: in flat, out climbing. Drawn heaviest of the three, so the
          bend is what the glyph is at a glance. */}
      <path d="M2.6 18.4h9l7.2-10" strokeWidth="2.3" />
      {/* The joint, marked across the leg the way a cut line is. */}
      <path d="m17.1 14-3.1-2.2" strokeWidth="1.3" />
      {/* The angle swept between the two, which is the number this menu sets. */}
      <path d="M17.6 18.4a6 6 0 0 0-2.5-4.87" strokeWidth="1.3" />
    </svg>
  )
}
