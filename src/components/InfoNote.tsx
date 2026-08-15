import type { ReactNode } from 'react'

/**
 * A one-line question that folds open into an explanation. Native `<details>`,
 * so it keeps keyboard and screen-reader behaviour for free.
 */
export default function InfoNote({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="info-note">
      <summary>{label}</summary>
      <p>{children}</p>
    </details>
  )
}
