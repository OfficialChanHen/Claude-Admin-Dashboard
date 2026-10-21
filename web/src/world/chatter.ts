import type { Role } from '../lib/api'
import { taskOf, type Station } from './tasks'

// Small talk. Now and then someone says a line that fits where they are and
// what they are doing: grumbling at the coffee machine, muttering over a test
// run, chatting on the sofa. Every line is written here, so it costs nothing
// to run and never calls a model. Real words from a session always win over these.

export type Topic =
  | 'coffee' | 'vending' | 'table' | 'sofa' | 'window' | 'plant' | 'morning' | 'late'
  | 'printer' | 'archive' | 'stretch' | 'phone'
  | 'read' | 'search' | 'edit' | 'run' | 'web' | 'plan' | 'delegate' | 'other'
  | 'test' | 'build' | 'git' | 'install' | 'lint'
  | 'testfile' | 'css' | 'docs' | 'config'
  | 'think' | 'idle' | 'waiting' | 'friday'
  | 'boss' | 'manager' | 'junior'
  | 'hello' | 'helloJunior' | 'bye'

export const LINES: Record<Topic, string[]> = {
  coffee: [
    'Coffee first, code second.',
    'Who finished the pot and didn\'t make more?',
    'This machine makes one noise and it\'s a sad one.',
    'Just a small one. Okay, a medium one.',
    'Oat milk again? Fine.',
    'Third cup. I\'m counting it as hydration.',
    'If this doesn\'t work, nothing will.',
    'The good mugs are always in the dishwasher.',
  ],
  vending: [
    'It ate my coin again.',
    'Crisps or the healthy bar. Crisps.',
    'B4. Come on, B4.',
    'Why is the water the most expensive thing in here?',
    'It\'s stuck. Do I shake it?',
    'One snack, then straight back.',
  ],
  table: [
    'Nice to sit somewhere without a screen.',
    'Anyone know whose sandwich this is?',
    'Five minutes, then back to it.',
    'I could get used to this table.',
    'Someone left crumbs everywhere.',
    'Good spot for thinking, this.',
  ],
  sofa: [
    'I\'m not napping, I\'m resting my eyes.',
    'This sofa is dangerously comfortable.',
    'Just letting the last change sink in.',
    'Is it break time or did I just decide that?',
    'Five more minutes.',
    'Best seat in the office.',
  ],
  window: [
    'Looks like rain later.',
    'Is that the same pigeon as yesterday?',
    'Busy out there today.',
    'Fresh air would be nice.',
    'I can see the cafe from here.',
  ],
  plant: [
    'Has anyone watered this?',
    'You\'re looking well today.',
    'I think it grew since Monday.',
    'Hang in there, little guy.',
    'Is this one real? It\'s real.',
  ],
  printer: [
    'Paper jam. Of course.',
    'Who prints things any more? Me, apparently.',
    'Page three of two. How?',
    'Still warm.',
    'PC LOAD LETTER? What does that mean?',
  ],
  archive: [
    'We did this exact thing last year.',
    'Ah, the old version. Simpler times.',
    'Who filed this under M?',
    'So that\'s why it\'s written like that.',
    'Some history never gets old.',
  ],
  stretch: [
    'Shoulders up, shoulders down.',
    'Too long at the desk.',
    'Ooh, that\'s the spot.',
    'Touch the toes. Nearly.',
    'Twenty seconds each side.',
  ],
  phone: [
    'Yes, I\'m still here.',
    'Can you hear me now?',
    'Let me call you back.',
    'No, the other project.',
    'Sorry, you cut out there.',
    'Sounds good. Bye. Bye. Okay, bye.',
  ],
  morning: [
    'Morning. Not talking until after this cup.',
    'Early start today.',
    'First coffee of the day, the important one.',
    'Morning! What did I miss?',
  ],
  late: [
    'Bit late for coffee, isn\'t it?',
    'Still here? Me too.',
    'Decaf. It\'s that time.',
    'One more task, then home. Probably.',
  ],

  read: [
    'Who wrote this? Oh. Me.',
    'Let me just find the bit that matters.',
    'Hm, interesting choice here.',
    'Okay, I see what this does.',
    'There\'s a comment here from years ago.',
    'Reading before writing. Good habit.',
    'This file is longer than I remembered.',
  ],
  search: [
    'It\'s in here somewhere.',
    'Where did we put that?',
    'Found one. Are there more?',
    'Wrong drawer.',
    'Somebody alphabetise these, please.',
    'Ah, there it is.',
    'Searching every folder, one by one.',
  ],
  edit: [
    'Just a small change.',
    'Tidier already.',
    'That reads better.',
    'Careful now.',
    'One line here, one line there.',
    'Don\'t break, don\'t break.',
    'Saving.',
  ],
  run: [
    'Let\'s see what happens.',
    'Here goes nothing.',
    'Running it.',
    'Come on, come on.',
    'Any second now.',
    'That\'s a lot of output.',
  ],
  web: [
    'Let me look that up.',
    'The docs say one thing, the forum says another.',
    'Just checking the docs.',
    'Too many tabs open.',
    'Ah, someone had this exact problem.',
    'This page has seven pop-ups.',
  ],
  plan: [
    'Step one, step two...',
    'Ticking that one off.',
    'Okay, here\'s the plan.',
    'Need more whiteboard.',
    'Who keeps taking the blue marker?',
    'Let me think this through.',
    'Moving that to the top of the list.',
  ],
  delegate: [
    'I\'ll get some help on this.',
    'Many hands.',
    'Someone can take this part.',
    'Splitting this up.',
  ],
  other: [
    'Never used this tool before. Let\'s see.',
    'Connecting to the other side.',
    'Bear with me.',
    'Fancy.',
  ],

  test: [
    'Fingers crossed on the tests.',
    'Please be green.',
    'Red. Of course it\'s red.',
    'All passing? Let me run it again to be sure.',
    'Who wrote a test that depends on the time of day?',
    'Testing, testing.',
  ],
  build: [
    'Building. Kettle time?',
    'The compiler has opinions.',
    'Type errors, my old friends.',
    'Come on, compile.',
    'It built! Wait, warnings.',
  ],
  git: [
    'What does git think of this?',
    'Clean working tree. Lovely.',
    'Let\'s check what changed.',
    'Who touched this last?',
  ],
  install: [
    'Downloading half the internet.',
    'How many packages does one app need?',
    'This will take a minute.',
    'node_modules is getting heavy.',
  ],
  lint: [
    'The linter is never happy.',
    'Missing semicolon. Classic.',
    'Tidying up after myself.',
  ],
  testfile: [
    'Writing the tests. The responsible thing.',
    'What if the input is empty?',
    'One more edge case.',
    'Test first. Well, test soon.',
  ],
  css: [
    'Nudging pixels.',
    'One pixel to the left.',
    'Why is this centred? Why is it not centred?',
    'Does this look right in dark mode?',
  ],
  docs: [
    'Writing docs. Someone has to.',
    'Future me will thank me.',
    'Keeping the readme honest.',
  ],
  config: [
    'Touching the config. Gently.',
    'One setting, big difference.',
    'Who set this flag?',
  ],

  think: [
    'Hmm.',
    'Let me think.',
    'Okay, but what if...',
    'Wait, that\'s it.',
    'Thinking...',
    'There\'s a neater way to do this.',
    'Right, where was I?',
  ],
  idle: [
    'All quiet.',
    'Inbox zero. For now.',
    'Ready when you are.',
    'Anything else?',
    'I should tidy this desk.',
    'Nice and calm today.',
    'Did I leave the oven on?',
  ],
  waiting: [
    'Need your call on this one.',
    'Over to you.',
    'Just need a yes or no.',
    'Whenever you\'re ready.',
    'I\'ll wait here.',
  ],
  friday: [
    'Nearly the weekend.',
    'Nothing risky on a Friday.',
    'Any plans for the weekend?',
  ],

  boss: [
    'How are we doing, team?',
    'Big picture, people.',
    'Let\'s keep things moving.',
    'Who moved my stapler?',
    'Great work, everyone.',
    'My door is always open. I don\'t have a door.',
  ],
  manager: [
    'Let\'s circle back on that.',
    'Quick sync, anyone?',
    'I\'ll put it in the report.',
    'How\'s everyone getting on?',
    'Looks on track to me.',
    'Noted.',
  ],
  junior: [
    'First week here. Still finding the stairs.',
    'Is this my desk?',
    'I\'ll have this done in no time.',
    'Where do they keep the pens?',
  ],

  hello: [
    'Morning, all.',
    'Hi everyone.',
    'Right, what\'s first?',
    'Back again.',
    'Let\'s get going.',
  ],
  helloJunior: [
    'Reporting in.',
    'Where do you need me?',
    'Hello! I\'m here to help.',
    'On my way.',
  ],
  bye: [
    'That\'s me done.',
    'See you next time.',
    'Heading out.',
    'Night, all.',
    'Good day\'s work.',
  ],
}

/** A short exchange between two people on a break: the first says one, the other answers. */
export const CHATS: [string, string][] = [
  ['Busy day?', 'Never stops.'],
  ['Seen the new build?', 'Faster, I think.'],
  ['How\'s your bug going?', 'Which one?'],
  ['Lunch later?', 'Always.'],
  ['Did you try turning it off and on?', 'Twice.'],
  ['Long week.', 'And it\'s only Tuesday. Probably.'],
  ['Good weekend?', 'Too short.'],
  ['Who broke the build?', 'Not me. Probably.'],
  ['Any good shows lately?', 'I only watch the logs.'],
  ['Is it me or is it warm in here?', 'It\'s the servers.'],
  ['What are you working on?', 'Honestly, not sure yet.'],
  ['Coffee\'s better today.', 'New beans.'],
  ['Tabs or spaces?', 'Not this again.'],
  ['I finally fixed it.', 'Nice! What was it?'],
  ['Meeting at three?', 'There\'s always a meeting at three.'],
  ['Nice mug.', 'Thanks, it\'s stolen.'],
  ['Hot desk again?', 'My room\'s full up.'],
  ['Printer working today?', 'Define working.'],
]

/** What someone is up to, for picking a line. */
export type Scene = {
  rank: 'senior' | 'junior'
  role?: Role | null
  activity: string
  state: string
  station: Station
  running: boolean
  tool: string | null
  summary: string
  /** The break spot they are standing at, if any. */
  spot: Topic | null
  asleep: boolean
  now: number
}

/** The topic for a line right now, or null if this is a bad moment to talk. */
export function topicFor(c: Scene, rand: () => number): Topic | null {
  if (c.asleep) return null
  const hour = new Date(c.now).getHours()
  const friday = new Date(c.now).getDay() === 5
  const special = c.role === 'boss' ? 'boss' : c.role === 'manager' ? 'manager' : c.rank === 'junior' ? 'junior' : null

  if (c.activity === 'break') {
    if (!c.spot) return null
    if (c.spot === 'coffee' || c.spot === 'vending') {
      if (hour < 11 && rand() < 0.4) return 'morning'
      if (hour >= 20 && rand() < 0.4) return 'late'
    }
    if (friday && rand() < 0.2) return 'friday'
    return c.spot
  }
  if (c.activity !== 'work') return null
  if (c.state === 'waiting') return 'waiting'
  if (c.running && c.tool) {
    if (special === 'junior' && rand() < 0.15) return 'junior'
    const kind = taskOf(c.tool)
    if (kind === 'ask') return 'waiting'
    return detail(c.tool, c.summary) ?? kind
  }
  if (special && special !== 'junior' && rand() < 0.5) return special
  if (c.rank === 'junior' || c.state === 'working') return 'think'
  if (friday && rand() < 0.3) return 'friday'
  return 'idle'
}

/** A closer topic from what the tool is working on: tests, builds, stylesheets. */
export function detail(tool: string, summary: string): Topic | null {
  const kind = taskOf(tool)
  const s = summary.toLowerCase()
  if (kind === 'run') {
    if (/\b(test|tests|vitest|jest|pytest|spec)\b/.test(s)) return 'test'
    if (/\b(npm|pnpm|yarn|pip|cargo|bun) (i|install|add)\b/.test(s)) return 'install'
    if (/\b(lint|eslint|prettier|format)\b/.test(s)) return 'lint'
    if (/\b(build|tsc|compile|typecheck)\b/.test(s)) return 'build'
    if (/\bgit\b|\bcommit\b/.test(s)) return 'git'
  }
  if (kind === 'edit') {
    if (/[._](test|spec)\.\w+$/.test(s)) return 'testfile'
    if (/\.(css|scss|sass|less)$/.test(s)) return 'css'
    if (/\.(md|mdx|txt|rst)$/.test(s)) return 'docs'
    if (/(package\.json|\.config\.\w+|\.ya?ml|\.toml|\.env|\.ini|tsconfig)/.test(s)) return 'config'
  }
  return null
}

/** One line on a topic, not the same as the last thing they said. */
export function lineFor(topic: Topic, rand: () => number, last = '') {
  const pool = LINES[topic]
  const options = pool.length > 1 ? pool.filter((l) => l !== last) : pool
  return options[Math.floor(rand() * options.length) % options.length]
}

export function chatFor(rand: () => number): [string, string] {
  return CHATS[Math.floor(rand() * CHATS.length) % CHATS.length]
}
