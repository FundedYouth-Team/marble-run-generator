import { useState, type ReactNode } from 'react'

/** A sidebar panel whose whole body folds away behind its heading. */
export default function CollapsiblePanel({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={open ? 'panel' : 'panel folded'}>
      {/* The button lives inside the heading, so the heading stays a heading. */}
      <h2>
        <button className="panel-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span>{title}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h2>
      {open && children}
    </section>
  )
}
