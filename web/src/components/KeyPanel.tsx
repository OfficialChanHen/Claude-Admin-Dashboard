import { useState, type ReactNode } from 'react'
import { PixelIcon } from './PixelIcon'
import { applyTheme, currentTheme, type Theme } from '../lib/theme'
import type { IconName } from '../lib/pixelIcons'
import { TASKS, THINGS, type TaskKind, type Thing } from '../world/tasks'
import { ART } from '../world/render'

// What everything on the floor means. Reads the same tables as the canvas.

const WHERE: { thing: Thing; tasks: TaskKind[] }[] = [
  { thing: 'cabinet', tasks: ['read', 'search'] },
  { thing: 'desk', tasks: ['edit', 'run', 'web', 'delegate'] },
  { thing: 'board', tasks: ['plan', 'ask'] },
]

const SIGNS: { icon: IconName | '!' | '+2'; tone?: 'turn' | 'bad'; text: string }[] = [
  { icon: '!', tone: 'turn', text: 'Needs your OK. The room gets a pink border and its lamp blinks red.' },
  { icon: 'dots', text: 'Thinking: a thought cloud with dots, and dots on their screen' },
  { icon: 'bulb', text: 'Just finished a thought' },
  { icon: 'check', text: 'Finished a turn (with confetti), or a helper handing back its report' },
  { icon: 'bang', tone: 'bad', text: 'A step failed' },
  { icon: 'question', text: 'Asking you a question' },
  { icon: 'cup', text: 'On a break between tasks: coffee, a snack, the sofa, a stretch, a phone call, the printer or the archive' },
  { icon: 'sleep', text: 'Dozing after a long quiet spell' },
  { icon: '+2', text: 'More helpers than there are desks (shown for the person you clicked)' },
]

const LAMPS: { color: string; text: string }[] = [
  { color: ART.lampGreen, text: 'Someone is working' },
  { color: ART.lampRed, text: 'Blinking: someone needs your OK' },
  { color: ART.lampAmber, text: 'Sessions are open but idle' },
  { color: ART.lampOff, text: 'Nobody in' },
]

function Lighting() {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  return (
    <div className="seg" role="group" aria-label="Theme">
      {([['system', 'Auto'], ['dark', 'Dark'], ['light', 'Light']] as const).map(([k, l]) => (
        <button
          key={k}
          aria-pressed={theme === k}
          onClick={() => {
            applyTheme(k)
            setTheme(k)
          }}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

/** A tiny monitor, drawn like the ones on the desks. */
function Screen({ kind }: { kind: 'edit' | 'run' | 'web' | 'wait' }) {
  const bg = kind === 'run' ? ART.term : kind === 'wait' ? 'var(--turn)' : ART.paper
  return (
    <svg className="key-screen" viewBox="0 0 10 8" aria-hidden shapeRendering="crispEdges">
      <rect width="10" height="7" fill={ART.outline} />
      <rect x="1" y="1" width="8" height="5" style={{ fill: bg }} />
      {kind === 'run' && (
        <>
          <rect x="1" y="1" width="5" height="1" fill={ART.termText} />
          <rect x="1" y="3" width="3" height="1" fill={ART.termText} />
          <rect x="1" y="5" width="1" height="1" fill={ART.termText} />
        </>
      )}
      {kind === 'edit' && (
        <>
          <rect x="2" y="1" width="5" height="1" fill={ART.code2} />
          <rect x="3" y="3" width="4" height="1" fill={ART.code1} />
          <rect x="2" y="5" width="3" height="1" fill={ART.code3} />
        </>
      )}
      {kind === 'web' && (
        <>
          <rect x="1" y="1" width="8" height="1" fill={ART.code2} />
          <rect x="2" y="3" width="3" height="2" fill={ART.screen} />
          <rect x="6" y="3" width="2" height="1" fill={ART.outline} />
        </>
      )}
    </svg>
  )
}

function Row({ mark, tone, children }: { mark: ReactNode; tone?: string; children: ReactNode }) {
  return (
    <div className="key-row">
      <span className={`key-mark ${tone ?? ''}`}>{mark}</span>
      <div>{children}</div>
    </div>
  )
}

export function KeyPanel() {
  return (
    <div className="key-panel">
      <section>
        <h3>Where the work happens</h3>
        {WHERE.map(({ thing, tasks }) => (
          <Row key={thing} mark={<PixelIcon name={THINGS[thing].icon} />}>
            <b>{THINGS[thing].name}</b>: {THINGS[thing].does}
            <div className="key-chips">
              {tasks.map((t) => (
                <span key={t} className="key-chip"><PixelIcon name={TASKS[t].icon} size={12} />{TASKS[t].verb}</span>
              ))}
            </div>
          </Row>
        ))}
        <p className="note">Furniture in use is outlined, and you can see the work on it: writing on the board, a drawer pulled open.</p>
      </section>

      <section>
        <h3>On the walls</h3>
        <p className="note">
          Every room has a name plate. Click it for the project’s settings. The lamp on the plate shows how the room is doing:
        </p>
        {LAMPS.map((l) => (
          <Row key={l.text} mark={<span className="key-lamp" style={{ background: l.color }} />}>{l.text}</Row>
        ))}
        <p className="note">
          In the hub: this notice board, the clock, and the plan meter showing your 5 hour and weekly use (click it for details). The
          lamp by the front door is green while HQ is live and blinks red while it reconnects. The back windows show the sky for the time of day.
        </p>
      </section>

      <section>
        <h3>Screens</h3>
        <Row mark={<Screen kind="edit" />}>Editing code</Row>
        <Row mark={<Screen kind="run" />}>Running a command</Row>
        <Row mark={<Screen kind="web" />}>Browsing the web</Row>
        <Row mark={<Screen kind="wait" />}>Waiting for your OK</Row>
      </section>

      <section>
        <h3>Over people</h3>
        <Row mark={<PixelIcon name="quote" />}>Speech bubbles are what they say to you. Click someone to read the whole conversation.</Row>
        <Row mark={<PixelIcon name="page" />}>
          Click someone and a label like <span className="key-chip"><PixelIcon name="page" size={12} />Reading auth.ts</span> says what they are doing right now
        </Row>
        {SIGNS.map((s) => (
          <Row key={s.icon} tone={s.tone} mark={s.icon === '!' || s.icon === '+2' ? <b>{s.icon}</b> : <PixelIcon name={s.icon} />}>
            {s.text}
          </Row>
        ))}
      </section>

      <section>
        <h3>People</h3>
        <p className="note">
          Someone in a shirt is one of your sessions. Someone in casual clothes is a helper it sent for. A helper comes in, gets a
          sheet with the task, works at a small desk, then walks the report back.
        </p>
        <div className="key-chips">
          <span className="key-chip role-boss">Boss</span>
          <span className="key-chip role-manager">Manager</span>
          <span className="key-chip role-agent">Agent</span>
          <span className="key-chip role-helper">Helper</span>
        </div>
        <p className="note">
          The tag under each person's feet is their role. The boss watches all the managers. A manager watches one project's agents.
          An agent is one of your sessions, and a helper is a subagent an agent sent for.
        </p>
        <Row mark={<PixelIcon name="door" />}>
          Drag one of your sessions to a door to send them home. That ends the session once you confirm. Drop them anywhere else and they walk back to their desk.
        </Row>
      </section>

      <section>
        <h3>Rooms</h3>
        <p className="note">
          Each project is a room. Click one to go in, and the prompt bar talks to that project. In Other folders it starts a chat
          about no project. In a room, the arrow keys go to the
          room next door. Escape, scrolling out, or clicking outside the room takes you back to the whole floor.
        </p>
      </section>

      <section>
        <h3>Theme</h3>
        <p className="note">
          Daylight in the office follows your clock: it gets dark in the evening, and the lamps, windows and screens light up. The
          light switch on the back wall, above the hub’s corridor, flips the panels between light and dark. Auto follows your system.
        </p>
        <Lighting />
      </section>
    </div>
  )
}
