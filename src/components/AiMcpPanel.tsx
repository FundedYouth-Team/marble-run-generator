import { useEffect } from 'react'
import InfoNote from './InfoNote'
import CollapsiblePanel from './CollapsiblePanel'
import { PROJECT_EXT } from '../lib/project'

/**
 * Slide-out AI / MCP: a look ahead at driving the app from plain language, so
 * the idea is written down where it will be built rather than only in a doc.
 *
 * Nothing here is wired to anything — there is no server, and no button on this
 * panel changes the run. It is a placeholder with the shape of the plan in it,
 * kept honest by saying so at the top rather than showing dead controls.
 */
export default function AiMcpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    // Closed, it is only parked off-screen — inert keeps it out of the tab order too.
    <aside className={open ? 'parts-panel open' : 'parts-panel'} inert={!open}>
      <header className="parts-head">
        <h3>AI / MCP</h3>
        <button className="help-close" onClick={onClose} aria-label="Close AI and MCP">
          ✕
        </button>
      </header>

      <div className="parts-body">
        <section className="help-beta">
          <h4>
            <span className="beta">Planned</span> Not built yet
          </h4>
          <p>
            A future integration that needs further testing before it is switched on. Nothing on
            this panel is connected, and no part of it can change your run.
          </p>
        </section>

        <p className="note">
          The idea: describe a run in plain language to an AI assistant and get a real{' '}
          {PROJECT_EXT} project back, which you open here with the same Open button you use now.
          The run is already a plain saved file, so the assistant only has to write one correctly.
        </p>

        <CollapsiblePanel title="What is MCP?" defaultOpen={false}>
          <p className="note">
            Model Context Protocol — a standard way to hand an AI assistant a set of tools it may
            call. A small program would run on your machine, offer tools like <em>add a part</em>{' '}
            and <em>export a print plate</em>, and the assistant would call them on your behalf.
          </p>
          <InfoNote label="Would this send my runs anywhere?">
            Not as planned. The intended first version runs entirely on your own machine and writes
            files to your own disk. The assistant sees the parts it is working on, in the same way
            it sees any file you show it — nothing is uploaded on its own.
          </InfoNote>
        </CollapsiblePanel>

        <CollapsiblePanel title="Planned tools" defaultOpen={false}>
          <ul className="note" style={{ paddingLeft: '1.1em', display: 'grid', gap: 4 }}>
            <li>Start a new run, or open a saved one</li>
            <li>Add, change and remove parts</li>
            <li>Read the run back — parts, joints and anything that does not line up</li>
            <li>Save the project, or export STL, 3MF or OBJ</li>
          </ul>
          <p className="note">
            Camera, theme, units and the simulator stay out of it. Those are how you look at a run,
            not the run itself.
          </p>
        </CollapsiblePanel>

        <CollapsiblePanel title="Why it is not on yet" defaultOpen={false}>
          <p className="note">
            The hard part is not the wiring — it is whether an assistant can lay out a run that
            actually rolls. A part in the wrong place looks fine on screen and jams the marble. That
            wants testing against real runs before anything here is switched on.
          </p>
          <p className="note">
            There is also groundwork first: the joint and sizing rules currently live inside the
            app, and have to be lifted somewhere a separate program can use them without changing
            how the app behaves.
          </p>
          <InfoNote label="Where is this written down?">
            In <code>docs/mcp-integration.md</code> in the repository — the phases, the tool list,
            and what still has to be decided.
          </InfoNote>
        </CollapsiblePanel>

        <p className="note">
          In the meantime you can already export a {PROJECT_EXT} project and hand it to an assistant
          yourself. It is plain JSON, and anything it hands back opens here.
        </p>
      </div>
    </aside>
  )
}
