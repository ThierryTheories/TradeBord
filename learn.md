# Engineering Log — Crypto Trading Dashboard

> A teaching document for the TradingView-style dashboard in this repo.
> Written for someone who wants to eventually build this **without** AI.

---

## 1. WHAT ARE WE TRYING TO DO?

**The goal:** open a webpage and see a live, interactive candlestick chart of any
crypto market, with the ability to search 1,368 different trading pairs, switch
timeframes, and scroll back through history.

**The problem we're solving:** TradingView already exists — so why build this?
Because embedding TradingView's iframe means you own nothing. You can't add your
own indicators, you can't overlay your own trade history, you can't connect a
second exchange, and you can't style it. The moment you want _your_ product to do
something TradingView doesn't, an iframe is a dead end.

So the real goal of version 1 isn't "a chart." It's **an architecture that a chart
happens to sit on top of.** If we get the architecture right, adding Bybit, adding
indicators, and adding trade markers later are small changes. If we get it wrong,
each of those becomes a rewrite.

That distinction — _building the foundation vs. building the feature_ — is one of
the biggest differences between junior and senior engineering work.

---

## 2. BIG PICTURE

Here's how data actually flows through the app:

```
                    ┌─────────────────────────────┐
                    │   Binance public API        │
                    │   (external, not ours)      │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
        REST (HTTP)                       WebSocket
     "give me the past"                "tell me about now"
              │                                 │
              │  1000 historical candles        │  ~2 messages/second
              │  symbol list, 24h stats         │  updates to the forming candle
              │                                 │
              ▼                                 ▼
      ┌───────────────────────────────────────────────┐
      │  services/providers/binance.ts                │
      │  The ONLY file that knows Binance exists.     │
      │  Translates Binance's format → our format.    │
      └────────────────────┬──────────────────────────┘
                           │  normalized Candle / Quote / MarketSymbol
                           ▼
      ┌───────────────────────────────────────────────┐
      │  services/marketData.ts                       │
      │  The interface + registry ("the contract")    │
      └────────────────────┬──────────────────────────┘
                           │
                           ▼
      ┌───────────────────────────────────────────────┐
      │  hooks/  (useCandleFeed, useSymbolUniverse)   │
      │  Owns *when* to fetch and *how* to merge      │
      │  history + live data into React state.        │
      └────────────────────┬──────────────────────────┘
                           │  props
                           ▼
      ┌───────────────────────────────────────────────┐
      │  components/  (Chart, Header, TickerSearch)   │
      │  Pure display. Knows nothing about Binance.   │
      └───────────────────────────────────────────────┘
                           │
                           ▼
                        The user
```

### Why the split matters

Read that diagram bottom-up and ask: _"if Binance disappeared tomorrow, how many
boxes would I have to change?"_

**One.** `binance.ts`. Everything above it speaks our vocabulary, not Binance's.

That property has a name: **the dependency rule**. Dependencies point _inward_
toward stable, abstract things (our `Candle` type), never outward toward volatile,
concrete things (Binance's JSON). You'll see this idea again under names like
_Hexagonal Architecture_, _Ports and Adapters_, and _Clean Architecture_. They're
all the same insight wearing different hats.

### Why two transports instead of one?

This trips up a lot of people, so it's worth being precise:

|         | REST                                | WebSocket                            |
| ------- | ----------------------------------- | ------------------------------------ |
| Shape   | Request → Response, then done       | Open pipe, server pushes whenever    |
| Good at | "Give me 1,000 bars from last week" | "Tell me the instant price moves"    |
| Cost    | New connection per request          | One connection held open             |
| Bad at  | Real-time (you'd have to poll)      | Bulk history (no "give me the past") |

Polling REST every second for live prices would be wasteful and laggy. Opening a
WebSocket to ask for 1,000 historical bars is the wrong tool. **So we use both**,
and the interesting engineering is in _stitching them together_ — which is what
`useCandleFeed` does, and where the subtle bugs live.

---

## 3. WHAT TECHNOLOGIES ARE WE USING?

### TypeScript

**What:** JavaScript with a type system bolted on. You write `price: number`, and a
compiler checks you never accidentally put a string there.

**Why we used it:** Financial data is a minefield of type confusion. Binance sends
prices as **strings** (`"76896.01"`), not numbers — because floating-point rounding
can silently destroy money. Timestamps arrive in **milliseconds**, but the charting
library demands **seconds**. TypeScript makes those mismatches compile errors
instead of a chart that renders in the year 58,000.

**Alternatives:** Plain JavaScript (faster to start, far more runtime bugs);
JSDoc comments (types without a build step); Flow (mostly dead).

**Verdict:** TypeScript is the industry standard for new frontend projects in 2026.
**Career flag:** not knowing TypeScript closes a lot of doors right now.

---

### React

**What:** A library for building UIs out of composable components. You describe
what the screen _should look like_ for a given state, and React figures out the DOM
changes.

**Why:** Our UI has state that changes constantly (price ticks, selected symbol,
timeframe) and several pieces that must stay in sync. Doing that by hand with
`document.querySelector` is how you end up with a UI that disagrees with itself.

**Alternatives:** Vue (gentler learning curve), Svelte (compiles away, less runtime),
Angular (heavier, more opinionated), or vanilla JS.

**Honest note:** React is the market leader by a wide margin, which matters for
employability more than it matters technically. Svelte and Solid are arguably nicer
designs.

---

### Vite

**What:** The build tool. Two jobs: (1) a dev server with instant hot-reload,
(2) bundling your app into optimized files for production.

**Why:** Browsers can't read `.tsx` files or resolve `import x from 'react'`.
Something must transform and bundle. Vite is fast because in dev it serves native
ES modules and only transforms the file you actually changed.

**Alternatives:** Webpack (older, slower, more configurable), Parcel, esbuild,
Turbopack, or Next.js (a full framework that includes bundling).

**Why not Next.js?** Next.js's headline feature is server-side rendering. Our chart
is 100% client-side — it needs a live WebSocket and a `<canvas>`, neither of which
exists on a server. We'd pay Next's complexity and get nothing back. **Choosing the
lighter tool when you don't need the heavier one is a real engineering skill.**

---

### TradingView Lightweight Charts

**What:** A ~45 KB charting library that renders financial charts to HTML `<canvas>`.
Made by TradingView, but a normal npm package — _not_ an iframe or embed.

**Why:** Rendering 1,000 candles with smooth 60fps pan and zoom is genuinely hard.
Doing it in DOM elements would be unusably slow (1,000 divs re-laid-out on every
mouse move). Canvas draws pixels directly.

**Alternatives:** Chart.js (general purpose, weak at financial charts), D3 (you'd
build candlesticks from scratch), Highcharts Stock (commercial license),
ApexCharts, or the TradingView iframe widget (which you explicitly ruled out).

**Version gotcha — flag this:** v5 changed the API. Old tutorials say
`chart.addCandlestickSeries()`. In v5 it's `chart.addSeries(CandlestickSeries, {...})`.
I verified the installed version's actual type definitions before writing code
rather than trusting memory. **Always check the version you actually have.**

---

### Tailwind CSS

**What:** A CSS framework where you compose styles from small utility classes in
your markup — `flex items-center gap-2` instead of writing a `.header` rule.

**Why:** No context-switching between files, no naming things, and dead styles can't
accumulate because styles live with the markup that uses them.

**Trade-off, honestly:** your JSX gets visually noisy. Some very good engineers
dislike it for that reason. Alternatives: CSS Modules, styled-components,
plain CSS, or vanilla-extract. This is genuinely a taste call, not a correctness one.

**What we used it for:** design tokens. In `src/index.css` there's an `@theme` block
defining `--color-panel`, `--color-up`, `--color-down`, etc. Every component uses
`bg-panel` / `text-up`, so re-theming the whole terminal is a one-file change.

---

### REST and WebSockets (the protocols)

**REST** is a convention for HTTP APIs: URLs identify resources, HTTP verbs
(`GET`/`POST`) say what to do, and each request is independent — the server
remembers nothing between them (_stateless_).

**WebSocket** is a different protocol that upgrades an HTTP connection into a
permanently-open two-way pipe. Once open, the server can push data at you without
being asked.

**Alternatives to WebSocket:** Server-Sent Events (simpler, one-way only — would
actually have worked here); HTTP long-polling (older workaround); polling on a
timer (simplest, worst latency). We used WebSocket because it's what Binance offers.

---

### JSON

The text format all this data travels in. Worth internalizing one thing: **JSON has
no date type and no decimal type.** That's exactly why Binance sends timestamps as
integers and prices as strings, and why our provider has to convert both. Nearly
every "weird API format" question traces back to a limitation of JSON.

---

## 4. WHAT DID YOU DO? (chronological)

**1. Inspected the existing project.**
Found an empty `main.py` and a git repo with zero commits. _Why first:_ you never
know whether you're extending or greenfielding until you look. Rewriting someone's
working code because you didn't check is a classic junior mistake.

**2. Probed the API before writing a line of app code.**
Ran `curl` against Binance endpoints. This immediately paid off — see §10, where
three separate assumptions turned out to be wrong. _Why:_ the API is the one part
of the system you don't control. Discovering its constraints _after_ building
around them means rework.

**3. Scaffolded the project by hand** (`package.json`, `tsconfig`, `vite.config.ts`)
rather than `npm create vite`. _Why:_ the directory wasn't empty, and the scaffolder
prompts interactively, which doesn't work in an automated shell.

**4. Wrote the types first** (`src/types/market.ts`).
_Why:_ the type definitions **are** the design. Deciding that a `Candle` has `time`
in seconds, and that a `MarketSymbol` carries its own exchange, settles most
downstream arguments before they happen. **Career flag: designing your data model
before your functions is a genuinely senior habit.**

**5. Wrote the interface before the implementation** (`marketData.ts` before
`binance.ts`). _Why:_ if you write Binance first and extract an interface later,
the interface ends up shaped exactly like Binance — and the second exchange won't
fit. Writing the contract first forces it to be venue-neutral.

**6. Implemented the Binance provider.** REST fetching, WebSocket hub, and the
translation layer from Binance's format to ours.

**7. Built the React hooks** — the layer that decides _when_ to fetch and how to
merge two data sources into state.

**8. Built the components** — pure display, fed entirely by props.

**9. Typechecked, then built, then actually ran it in a browser** and drove it
with a script: clicked timeframe buttons, typed in the search, scrolled the wheel,
dragged to pan.

**10. Found and fixed three real bugs that only appeared when running it.** (§10.)

The ordering here is the lesson: **types → contract → implementation → state →
UI → verify.** Each layer only depends on the ones before it, so you're never
guessing about something you haven't built yet.

---

## 5. FILES & ARCHITECTURE

```
src/
├── types/
│   └── market.ts          ← the vocabulary. Zero dependencies.
├── services/
│   ├── marketData.ts      ← the contract + registry
│   └── providers/
│       ├── binance.ts     ← the ONLY Binance-aware file
│       └── index.ts       ← wiring: registerProvider(new BinanceProvider())
├── hooks/
│   ├── useCandleFeed.ts   ← merges REST history + WS live bar
│   ├── useSymbolUniverse.ts ← loads + ranks 1,368 symbols
│   └── useLiveQuote.ts    ← header stats + connection status
├── lib/
│   └── format.ts          ← number → display string
├── components/
│   ├── TradingDashboard.tsx ← composition root: owns the state
│   ├── Header.tsx
│   ├── Chart.tsx
│   ├── TickerSearch.tsx
│   └── TimeframeSelector.tsx
├── App.tsx
├── main.tsx               ← entry point
└── index.css              ← Tailwind import + design tokens
```

### What each folder is responsible for

**`types/`** — the shared vocabulary, and nothing else. No logic, no imports.
Every other folder depends on this; it depends on nothing. That's deliberate: the
most-depended-upon thing should be the least likely to change.

**`services/`** — talking to the outside world. This is the _only_ place allowed to
know about HTTP, URLs, or WebSockets. If you ever find `fetch(` inside a component,
something has gone wrong.

**`hooks/`** — the bridge between "data exists" and "React knows about it."
Services answer _what_ the data is; hooks answer _when_ to get it, _how_ to store
it, and _what to do when it changes mid-request_.

**`components/`** — display only. `Chart.tsx` doesn't know Binance exists. You
could hand it made-up candles and it would render them happily — which is exactly
what makes it testable.

**`lib/`** — pure helper functions with no dependencies on anything in the app.

### The two files worth studying

**`services/marketData.ts`** — this is the keystone. It defines the
`MarketDataProvider` interface (what every exchange must be able to do), a registry
(a `Map` from exchange id → implementation), and a facade object that routes each
call to the right provider based on `symbol.exchange`.

That last part is the clever bit: because the exchange travels _inside_ the symbol,
a future watchlist mixing Binance and Bybit needs no special handling. The routing
is automatic.

**`hooks/useCandleFeed.ts`** — this is where the two transports become one dataset,
and where the hardest bugs in the app live. Worth reading line by line.

---

## 6. CODE CONCEPTS YOU SHOULD LEARN

### Interfaces and dependency inversion

An **interface** is a contract: "anything calling itself a `MarketDataProvider`
must have `getCandles`, `listSymbols`, `subscribeCandles`…"

The important move is _which direction the dependency points_. Our UI doesn't
depend on Binance; Binance depends on an interface our app defines. That inversion
is why adding Bybit is additive rather than invasive. **This is the single most
valuable architectural idea in this codebase.**

### Adapter / normalization pattern

Binance gives us `[1789045200000, "76896.01", ...]` — a tuple of strings with
millisecond timestamps. We turn it into `{ time: 1789045200, open: 76896.01, ... }`.

That translation function is an **adapter**. Every external system you integrate
should have exactly one. The alternative — letting Binance's shape leak into your
components — means every component breaks when Binance changes a field name.

### async / await and Promises

A **Promise** represents a value that isn't here yet. `await` pauses the function
until it arrives, letting you write asynchronous code that _reads_ sequentially.

Network calls are asynchronous because they take 50–500ms, and JavaScript is
single-threaded — blocking would freeze the whole page.

### Race conditions ⚠️ (the big one)

Concretely: you click BTC, then quickly click ETH. Two requests are in flight.
**There is no guarantee they come back in that order.** If BTC's response lands
second, you'd display BTC data under an ETH header.

Our fix in `useCandleFeed`:

```ts
const requestId = ++requestRef.current; // claim a ticket number
// ...later, when the response arrives:
if (requestId !== requestRef.current) return; // a newer request superseded me
```

Every async result checks whether it's still relevant before touching state.
**Career flag: "how do you handle a race condition in a search-as-you-type box?"
is an extremely common interview question. This is the answer.**

### React state vs. refs

- **State** (`useState`) — changing it re-renders the component.
- **Ref** (`useRef`) — a mutable box that survives re-renders but does _not_ trigger one.

We use refs for request IDs and for "what does the chart currently hold," because
those are bookkeeping, not display. Putting them in state would cause pointless
re-renders — or infinite loops.

### The stale closure problem

A function defined inside a component "captures" the variables as they were at that
moment. Register that function as a WebSocket handler and it keeps seeing _old_
values forever.

Our fix in `Chart.tsx`: register the handler once, but have it read from a ref
that we keep pointing at the current value:

```ts
const candlesRef = useRef(candles);
candlesRef.current = candles; // updated every render
```

**This is one of the most common sources of "impossible" React bugs.**

### Effect cleanup and subscriptions

Anything you _start_ in a `useEffect` you must _stop_ in the returned cleanup
function — timers, listeners, WebSocket subscriptions. Otherwise you leak: switch
symbols ten times and you have ten live subscriptions all fighting to update state.

### Immutability

We never do `candles.push(bar)`. We do `[...candles, bar]`.

React decides whether to re-render by comparing object identity (`oldArray ===
newArray`). Mutating in place leaves the identity unchanged, so React sees "nothing
happened" and your UI silently fails to update.

### Caching and memoization

- `useMemo` — don't recompute an expensive value unless its inputs changed.
- `useCallback` — don't recreate a function on every render.
- Our provider caches the 1,368-symbol list in a **promise** (not a value), so ten
  simultaneous callers share one network request instead of firing ten.

### Debouncing / grace periods

The WebSocket hub waits 1.5s before closing an idle connection, because switching
symbols unsubscribes the old stream a beat before the new one subscribes. Without
the delay you'd tear down and rebuild the socket on every click. Same family of
idea as debouncing a search input.

### Floating point and money

`0.1 + 0.2 !== 0.3` in every language using IEEE-754 floats. That's why exchanges
send prices as strings and why they publish a `tickSize`. We read `tickSize` per
symbol to decide decimal places — which is why PEPE renders as `0.00000335` and
BTC as `77,015.69`. **Never store money as a float in a real system**; use integers
of the smallest unit, or a decimal type.

---

## 7. TOOLS & COMMANDS

| Command                      | What it does                                             | Why we needed it                                                                          |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `curl <url>`                 | Makes an HTTP request from the terminal                  | Probing the Binance API _before_ writing code. Found the geo-block and the 17 MB payload. |
| `curl -w "%{size_download}"` | Prints transfer stats                                    | Measuring response sizes to decide what's safe to load in a browser                       |
| `npm install`                | Reads `package.json`, downloads deps into `node_modules` | Getting React, Vite, Lightweight Charts                                                   |
| `npm run dev`                | Runs the `dev` script → Vite dev server on :5173         | Local development with hot reload                                                         |
| `npm run build`              | `tsc -b && vite build` → optimized files in `dist/`      | Producing what you'd actually deploy                                                      |
| `npx tsc -b`                 | Runs the TypeScript compiler in "build" mode             | Typechecking. **Fast feedback loop — run this constantly.**                               |
| `npx vite preview`           | Serves the built `dist/` folder                          | Verifying the _production_ build, not just dev                                            |
| `git status` / `git log`     | Inspect repo state                                       | Checking whether there was existing work                                                  |
| `node script.mjs`            | Runs JavaScript outside the browser                      | Ran the WebSocket connectivity test and the browser driver                                |
| `grep` / `sed`               | Search and stream-edit text                              | Verifying the installed library's API; applying targeted patches                          |

**The workflow loop to internalize:**

```
edit  →  npx tsc -b  →  npm run dev  →  look at it in the browser  →  repeat
```

Typecheck is seconds and catches type errors. The browser catches everything else.
**Neither one alone is enough** — §10 is entirely bugs that typechecked perfectly.

---

## 8. DEPENDENCIES

### Runtime dependencies (shipped to the user's browser)

**`react` + `react-dom`** — the UI library and its browser renderer (they're
separate because React also targets React Native). Remove them and there is no app.

**`lightweight-charts`** — the canvas charting engine. Remove it and you'd be
hand-drawing candlesticks with the Canvas 2D API. Alternatives in §3.

### Development dependencies (build-time only, never shipped)

**`vite`**, **`@vitejs/plugin-react`** — the bundler and its React support (JSX
transform + hot reload).
**`typescript`** — the compiler. Produces _no_ runtime code; it erases types and
checks them.
**`tailwindcss`**, **`@tailwindcss/vite`** — generates the CSS. The output CSS ships;
the tool doesn't.
**`@types/react`**, **`@types/react-dom`** — type definitions only. React is written
in JavaScript, so its types are published separately.

### Why the distinction matters

`dependencies` end up in your production bundle; `devDependencies` don't. Putting a
build tool in `dependencies` bloats deploys. Putting a runtime library in
`devDependencies` means production crashes. **Interviewers ask this.**

### Verification-only (deliberately NOT in your package.json)

`playwright-core` — a browser automation library, installed in a scratch directory
outside the project. I used it to drive real Chrome against the app. It's kept out
of `package.json` because it wasn't part of the requested build.

### One honest note on dependency choice

I pinned `typescript` to `~5.9` even though `7.0` exists. TypeScript 7 is a ground-up
rewrite in Go, and on a fresh project with a new Vite major, stacking two bleeding-edge
versions multiplies the ways things can break. **Choosing boring versions for the
parts you aren't trying to learn about is a real skill.**

---

## 9. ENGINEERING DECISIONS

### Provider interface instead of calling Binance directly

_Chose:_ an interface + registry. _Instead of:_ `fetch('https://api.binance.com/...')`
inside `Chart.tsx`.
_Cost:_ ~120 extra lines and one more layer to trace through.
_Benefit:_ adding an exchange is one new file plus one line of wiring.
_Honest caveat:_ if you were certain you'd only ever use one exchange, this would be
over-engineering. You explicitly said Bybit and Bitget are coming — **that stated
requirement is what justifies the abstraction.** Abstractions built on _speculation_
are usually a mistake; abstractions built on _known_ requirements usually aren't.

### `id: "binance:BTCUSDT"` instead of `symbol: "BTCUSDT"`

`BTCUSDT` is not globally unique — it exists on Binance, Bybit, and Bitget with
different tick sizes and different prices. A bare ticker string is a bug waiting for
your second exchange. **Compound keys for things that are only unique within a
namespace** is a broadly useful lesson (it applies to database design too).

### Separate `liveBar` from the `candles` array

_Chose:_ two pieces of state. _Instead of:_ one array we mutate on every tick.
_Why:_ a new array on every tick means React passes a new prop to `Chart`, which
would re-seed all 1,000 candles ~2×/second — destroying the user's zoom and scroll.
Keeping the forming bar separate lets the chart call `series.update()` on one bar.
**Performance decisions often look like data-structure decisions.**

### Client-side only, no backend

_Chose:_ the browser talks to Binance directly. _Instead of:_ our own API server.
_Why:_ Binance's market-data endpoints are public, need no API key, and send
permissive CORS headers. A backend would add cost and latency for zero benefit.
_When this changes:_ the moment you need an API **secret**. A key in frontend code
is visible to everyone — at that point you need a backend to hold it. (See §11.)

### Chose `data-api.binance.vision` over `api.binance.com`

Not a preference — `api.binance.com` **failed to connect from this machine**
(geo-restriction). Verified by `curl`. The `.vision` host is Binance's public
market-data mirror. I kept `api.binance.com` as a fallback in the host list.
**Lesson: test connectivity from the actual environment, not from assumptions.**

### `useState` instead of Redux / Zustand

The app has three pieces of state (symbol, timeframe, hovered bar), all owned by one
component. Adding a state-management library here would be pure ceremony.
**Reach for a state library when prop-drilling actually hurts — not preemptively.**

### Tailwind design tokens instead of hardcoded colors

`bg-panel` instead of `bg-[#0e1116]`. Costs one CSS block; makes re-theming a
one-file change instead of a find-and-replace across twelve files.

---

## 10. TESTING & DEBUGGING (the real story)

I did not write unit tests for v1 — you asked for a foundation, and the risky part
here isn't pure logic, it's _integration_ (does the real API behave as assumed? does
the chart actually paint?). So verification was: **typecheck → build → drive the
real app in a real browser with a script.**

The script launched Chrome, navigated to the app, and then clicked, typed, scrolled
the mouse wheel, and dragged — then read pixels back off the canvas to prove things
actually changed. **Screenshots were taken and inspected.** A chart that "renders"
into a blank black rectangle still passes a naive `expect(canvas).toExist()`.

Here is everything that went wrong.

---

### Bug 0 — `api.binance.com` unreachable (found _before_ writing code)

**Symptom:** `curl` exit code 35 (SSL connect error), HTTP `000`.
**Diagnosis:** ran the same request against a second host; `data-api.binance.vision`
returned `200`. So: not our code, not the internet — that specific host is blocked.
**Fix:** made the `.vision` mirror primary, kept the other as fallback.
**Lesson:** probing the API first turned a "why is my app broken?" mystery into a
30-second finding.

---

### Bug 1 — the 17 MB symbol list

**Symptom:** `exchangeInfo` returned **17,515,607 bytes**. Unacceptable to load in a
browser.
**First attempt:** use the small `ticker/price` endpoint (157 KB) instead and guess
each pair's base/quote by string-matching known suffixes.
**Why I rejected it:** I _tested the heuristic against the truth_ and it got 9 pairs
wrong (`ADAEUR` → guessed quote `AEUR` instead of `EUR`). Silent wrongness.
**Second attempt:** filter for actively-trading pairs using `count > 0`. **Also
tested — also wrong**: 1,725 delisted pairs report stale non-zero counts.
**Actual fix:** read the docs properly and found query parameters:
`?showPermissionSets=false&symbolStatus=TRADING` → 2.5 MB raw, **52 KB gzipped**,
and it includes authoritative `baseAsset`/`quoteAsset`/`tickSize`.
**Lesson:** two clever hacks, both _measured_, both rejected. The boring correct
answer was in the API docs. **Measure your hack before you commit to it.**

---

### Bug 2 — search ranked ETH/IDR above ETH/USDT ⭐ the best bug here

**Symptom:** typing "ETH" and pressing enter gave **ETH/IDR** (Indonesian Rupiah).
Same for SOL and PEPE.
**Diagnosis:** I was sorting results by 24-hour `quoteVolume` descending, assuming
higher volume = more relevant. But **quote volume is denominated in the quote
currency.** ETH/IDR turns over ~10¹¹ _rupiah_; ETH/USDT turns over ~10⁸ _dollars_.
I was comparing a number of rupiah against a number of dollars as if they were the
same unit.
**Fix:** rank by settlement-currency tier first (USDT → USDC → FDUSD → BTC → …),
and only compare volumes between pairs sharing a quote currency.
**Lesson:** **a number without its unit is not data.** This class of bug — comparing
quantities that aren't in the same unit — has crashed spacecraft (Mars Climate
Orbiter, 1999). It typechecks perfectly, because `number === number`.

---

### Bug 3 — the OHLC legend was invisible

**Symptom:** the automated check found the O/H/L/C text in the DOM, but the
screenshot showed nothing.
**Diagnosis:** the text existed and had a real bounding box — it was being _painted
over_ by the chart's `<canvas>`, which the library positions absolutely.
**Fix:** one CSS class, `z-10`.
**Lesson:** "it's in the DOM" ≠ "the user can see it." **This is precisely the bug a
screenshot catches and an assertion-based test does not.** Look at your output.

---

### Bug 4 — WebSocket churn on every symbol switch

**Symptom:** console error `WebSocket connection failed: Ping received after close`
when switching symbols.
**Diagnosis:** React runs the _old_ effect's cleanup before the _new_ effect. So
switching symbols went: unsubscribe → zero subscribers → close socket → subscribe →
open a brand-new socket. Full teardown and rebuild on every click.
**Fix:** a 1.5-second grace period before closing an idle socket, cancelled if
anything resubscribes.
**Lesson:** understanding your framework's _lifecycle ordering_ is what let me
explain the symptom. Guessing would have led to suppressing the warning instead of
fixing the churn.

---

### What could still fail (honest list)

- **Rate limiting** — hammer the symbol switcher and Binance will HTTP 429 you. No
  backoff for that case yet.
- **No automated tests** — every regression check is currently manual.
- **Single point of failure** — Binance down = app blank. A second provider would
  fix this, which the architecture already permits.
- **Bundle size** — 406 KB in one chunk (128 KB gzipped). Fine now; wants
  code-splitting as the app grows.

---

## 11. SECURITY & PERFORMANCE

### Security

**Why there are no secrets in this app.** We only use _public_ market-data
endpoints — no API key, no authentication. That's why calling Binance straight from
the browser is acceptable here.

**The rule to internalize:** anything in frontend code is **public**. Minified,
obfuscated, in a `.env` file — doesn't matter. The browser downloads it, so the user
can read it. `VITE_`-prefixed environment variables are _inlined into the bundle at
build time_. They are configuration, **not** secrets.

**When this project will need a backend:** the moment you want authenticated
endpoints — account balances, placing orders. A trading API key in frontend code is
a key that anyone can use to drain the account. That work belongs on a server that
holds the key and exposes only the narrow operations you intend.

**CORS**, briefly: browsers refuse cross-origin responses unless the server opts in
with headers. Binance's public data endpoints opt in; that's _why_ this works
without a proxy. A CORS error is the server declining — you generally can't fix it
from the frontend.

**Input handling:** the search box only filters an in-memory array, and React
escapes rendered text by default, so there's no injection surface here. That
changes the instant user input reaches a database query or `dangerouslySetInnerHTML`.

### Performance

**What we did, and why:**

| Technique                            | Where              | Effect                                        |
| ------------------------------------ | ------------------ | --------------------------------------------- |
| Gzip-aware endpoint choice           | symbol list        | 17 MB → 52 KB over the wire                   |
| Promise caching                      | `listSymbols()`    | 10 callers → 1 request                        |
| `series.update()` not `setData()`    | live ticks         | avoids re-seeding 1,000 bars 2×/sec           |
| State split (`liveBar` vs `candles`) | `useCandleFeed`    | keeps the above possible                      |
| `useMemo` on search                  | `TickerSearch`     | no re-filtering 1,368 items per keystroke     |
| Canvas rendering                     | Lightweight Charts | 1,000 candles at 60fps; DOM couldn't          |
| Multiplexed WebSocket                | `StreamHub`        | one socket for all streams, not one each      |
| `ResizeObserver`                     | `Chart`            | resize on _container_ change, not just window |

**The transferable idea:** performance work is almost always about _doing less_, not
doing things faster. Every row above is "avoid work," not "optimize work."

**Measure before optimizing.** I only knew the symbol list was a problem because I
measured it with `curl -w "%{size_download}"`. Guessing at bottlenecks wastes effort
on things that were never slow.

---

## 12. WHAT I SHOULD REMEMBER

### Key concepts

1. **Dependency inversion** — your code defines the contract; external systems adapt
   to it. This is what makes "add another exchange" a small change.
2. **The adapter pattern** — exactly one place per external system translates their
   format into yours.
3. **Race conditions** — async responses can arrive out of order. Guard with a
   request-ID check before touching state.
4. **Stale closures** — handlers registered once capture old values; read from a ref.
5. **State vs. refs** — state re-renders, refs don't. Bookkeeping goes in refs.
6. **Immutability** — React detects change by identity; never mutate in place.
7. **Units are part of the data** — Bug 2. `number === number` typechecks and still
   lies to you.
8. **Effect cleanup** — anything you start, you must stop.
9. **REST for history, streams for now** — different tools, different jobs.
10. **Secrets can't live in a frontend.** Ever.

### New technologies encountered

React 19 · TypeScript · Vite · Tailwind CSS v4 · TradingView Lightweight Charts v5 ·
WebSocket protocol · REST/HTTP · JSON · npm · ResizeObserver · Canvas · Playwright

### Engineering lessons

- **Probe the external system before designing around it.** Three assumptions died
  in the first ten minutes of `curl`.
- **Measure your clever idea before you commit to it.** Two heuristics were tested
  and rejected in favour of a boring documented API parameter.
- **Typechecking is necessary and nowhere near sufficient.** Every bug in §10
  typechecked cleanly.
- **Look at the screenshot.** Bug 3 was invisible to assertions.
- **Justify abstractions with stated requirements**, not speculation.
- **Design the data model before the functions.**

### Things to research separately

- Clean / Hexagonal Architecture (Ports & Adapters)
- The React `useEffect` lifecycle and cleanup ordering — deeply
- IEEE-754 floating point, and how money is stored in real financial systems
- CORS and the browser security model
- HTTP caching headers, gzip/brotli
- Backpressure and reconnection strategies for streams
- Code splitting and lazy loading
- Testing: Vitest for units, Playwright for end-to-end

---

## 13. QUESTIONS FOR YOU

Answer these in your own words before reading any code. I'm not giving you the
answers unless you ask.

1. We put `exchange` _inside_ the `MarketSymbol` object rather than keeping a
   separate "current exchange" variable somewhere. What becomes possible later
   because of that choice?

2. `useCandleFeed` keeps `liveBar` in separate state from the `candles` array.
   What would visibly break for a user if we merged them into one array?

3. The search box only filters an array that's already in memory — no network call
   per keystroke. What did we trade away to get that, and when would that trade
   become a bad one?

---

---

# JUNIOR → MID-LEVEL ENGINEER ASSESSMENT

An honest read on where this project leaves you. I'm assessing **the material**,
not you personally — I haven't seen you write code yet.

## What you should now understand

- **Why layering exists.** Not "put files in folders," but the actual rule:
  dependencies point toward stable abstractions. You've seen a concrete payoff —
  adding an exchange is one file.
- **That REST and WebSockets solve different problems**, and that combining them is
  where the real complexity lives.
- **That the type system is a design tool**, not paperwork. Deciding `Candle.time`
  is seconds-UTC settled a dozen later questions.
- **That "it compiles" and "it works" are unrelated claims.** Four bugs, zero type
  errors.
- **That external APIs must be probed, not assumed.**
- **What a component boundary is for** — `Chart.tsx` is reusable precisely because
  it knows nothing about where candles come from.

## What you probably still don't understand (and that's expected)

- **The React rendering model, deeply.** You've seen refs, cleanup, and stale
  closures _used_. Predicting when an effect fires, and in what order relative to
  cleanup, is a different skill — and it's what Bug 4 actually required.
- **Why the two-channel state split is necessary.** You can read the comment
  explaining it. Deriving that design yourself, from "the chart resets its zoom
  twice a second," is the mid-level skill.
- **Testing.** There are none here. Knowing _what deserves a test_ is a real gap.
- **Backpressure, reconnection, and stream failure modes.** Our reconnect logic is
  reasonable but untested against a genuinely flaky network.
- **The build pipeline.** Vite is doing a great deal invisibly. If it broke, could
  you diagnose it?
- **Why `useMemo`/`useCallback` are where they are.** Applying them everywhere is a
  common junior over-correction that makes things slower.

## Concepts to practise deliberately

1. **Race conditions.** Build a search-as-you-type box against a slow API. Make it
   show the wrong results. Then fix it. You must _see_ the bug to own the fix.
2. **`useEffect` cleanup.** Build something that subscribes, deliberately omit the
   cleanup, and watch the leak in DevTools.
3. **Adapter pattern.** Take any two public APIs for the same kind of data (two
   weather APIs) and write one interface both satisfy.
4. **Reading type definitions.** I confirmed the v5 chart API by reading
   `node_modules/lightweight-charts/dist/typings.d.ts`, not by searching the web.
   **This skill compounds enormously.**
5. **Measuring before optimizing.** Practise `curl -w`, and the Network and
   Performance tabs in DevTools.

## What to rebuild yourself, without AI

In increasing difficulty:

1. **`lib/format.ts`** — warm-up. Pure functions, easy to verify.
2. **`TimeframeSelector.tsx`** — smallest real component. Props, callbacks, state
   lifted to a parent.
3. **`types/market.ts` + `services/marketData.ts`** — _design these from scratch
   before looking at mine._ Then compare. Where we differ, ask which is better and
   why. **This is the highest-value exercise in the list.**
4. **`useCandleFeed.ts`** — the hard one. Fetch history, subscribe to live updates,
   merge them, handle symbol switching without race conditions. Expect this to be
   genuinely difficult. It is the heart of the app.
5. **`Chart.tsx`'s data-sync effect** — the seed / prepend / append logic. Try the
   naive `setData()`-every-time version first and _watch_ it destroy your zoom.
   Feeling that failure is the point.

Don't rebuild `binance.ts` first. It's the longest file but mostly mechanical
translation — high effort, low insight.

## Three interview questions I'd ask you about this project

**1.** Walk me through what happens, end to end, from the moment a user clicks
"ETH/USDT" to the moment new candles appear on screen. Name the layers the request
passes through, and tell me what could go wrong at each one.

**2.** Our search ranked ETH/IDR above ETH/USDT, even though the sort was working
exactly as written and the code had no type errors. What category of bug is that,
why can't a type system catch it, and how would you defend against that category in
general?

**3.** We deliberately kept the live, in-progress candle in separate state from the
array of historical candles. Why? What would the user actually experience if we
merged them — and what does that tell you about how React decides to re-render?

---

_I'm not giving you the answers unless you ask. Try them out loud first — the
struggle is where the learning happens._
