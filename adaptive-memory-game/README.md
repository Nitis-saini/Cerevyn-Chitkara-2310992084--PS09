# Adaptive Memory Matching Game

**PS09 - Cerevyn Chitkara Technical Assessment**

A browser-based memory matching game that tracks your performance and automatically chooses the size and difficulty of your next round (4×4, 5×4 or 6×6) with a documented, configurable rule. It runs entirely in the browser: no backend, no database, no external services.

## Problem statement and objectives

Build a memory matching game that records how the player performs and adjusts the difficulty of the next round according to a clear rule.

Objectives:

- Three genuinely different difficulty levels, each with its own grid size and pair count (4×4 / 8 pairs, 5×4 / 10 pairs, 6×6 / 18 pairs).

- Correct matching logic (no third card during a mismatch, no double counting, no stale callbacks).

- Move counter, active-play timer, best result and a win state.

- A transparent adaptive-difficulty rule with configurable thresholds and an on-screen explanation.

- Restart, new game and next-round controls that fully reset state.

- Anonymous session history in `localStorage`, safe against corrupted data.

- Automated tests, linting, type checking, CI, and an Azure Static Web Apps deployment plan.

## Features implemented

- Three difficulty levels with different boards: Easy 4×4 (8 pairs), Medium 5×4 (10 pairs), Hard 6×6 (18 pairs). Pairs are generated dynamically from a pool of 18 unique emoji, then shuffled every round (Fisher-Yates), with an optional seeded shuffle for reproducible tests.

- Every card has a stable unique ID, a pair ID, and one of three states: face down, face up, matched.

- Success message when every pair on the current board is matched; instructions, counter and stats always show the current pair count.

- Moves (one move = two distinct cards revealed), pairs found out of the current total, elapsed time, difficulty badge, best time and fewest moves.

- Timer that starts on the first flip, stops on the win, never runs on the results screen, and cannot be duplicated by re-renders.

- Adaptive difficulty with a plain-language explanation of the next round.

- Restart round, New game (back to Easy), and Next round (after a win).

- Session history (last 5 results shown, up to 50 stored), validated on load, with a confirmed "Clear history".

- Complete dark colour theme (charcoal background, violet accent, light text) - see [Dark theme](#dark-theme).

- Board CSS is driven by the difficulty configuration, so every grid fits its container; card symbols and gaps scale with the number of columns.

- Responsive layout, keyboard-operable cards, visible focus, semantic HTML, `prefers-reduced-motion` support.

## Technology stack

| Technology | 

| --- | --- |

| React 19 + Hooks (`useReducer`, `useState`, `useEffect`, `useRef`) | Component model and predictable state updates |

| TypeScript (strict) | Type safety for state, actions and stored data |

| Vite | Fast dev server and simple production build |

| Plain CSS | Dark theme, responsive layout and 3D card-flip animation without extra libraries |

| Vitest, React Testing Library, user-event | Fast tests that exercise real user behaviour |

| ESLint (typescript-eslint, react-hooks) | Code-quality checks |

| GitHub Actions | Automated lint, type check, test, build |

| Azure Static Web Apps (proposed) | Free static hosting with GitHub integration |

| Browser `localStorage` | Anonymous session history with no server |

Runtime dependencies: only `react` and `react-dom`.

## Difficulty levels and adaptive policy

The game starts on **Easy**. Each level has its own board and its own performance targets. Everything below is defined in one place, [`src/config/gameConfig.ts`](src/config/gameConfig.ts).

| Level | Grid (columns × rows) | Pairs | Cards | Targets to "meet both" | Mismatch display time |

| --- | --- | --- | --- | --- | --- |

| Easy | 4 × 4 | 8 | 16 | 24 moves or fewer **and** 90 seconds or less | 1000 ms |

| Medium | 5 × 4 | 10 | 20 | 35 moves or fewer **and** 150 seconds or less | 900 ms |

| Hard | 6 × 6 | 18 | 36 | 60 moves or fewer **and** 300 seconds or less | 800 ms |

Players get progressively more moves and more time as the board grows (about 3.0, 3.5 and 3.3 moves per pair, and 11, 15 and 17 seconds per pair). They are starting values for a demonstration, not tuned from player data; adjust them in the config file. The current level's targets are shown in the instructions at the top of the page and in the statistics panel.

Rule, evaluated once when the round is won:

1. The completed round is judged against the targets of the level it was played on. Limits are **inclusive** (exactly 24 moves and 90 s on Easy still counts), and elapsed time is truncated to whole seconds.

2. If **both** targets are met, the next round moves **one level up** (Hard stays Hard).

3. Otherwise the next round is **Easy**.

| Played | Both targets met | A target missed |

| --- | --- | --- |

| Easy (4×4) | Medium (5×4) | Easy (4×4) |

| Medium (5×4) | Hard (6×6) | Easy (4×4) |

| Hard (6×6) | Hard (6×6) | Easy (4×4) |

The policy table is `ADAPTIVE_POLICY` in the config file, so a gentler rule (for example Hard to Medium on a miss) is a one-line change.

The new difficulty applies to the next round, never retroactively. **Next round** starts a fresh board with the selected level's grid and pair count; **Restart round** keeps the current level and grid; **New game** returns to Easy. The result panel explains the decision, for example: "You completed the previous round in 17 moves and 42 seconds. Your next round will be Medium (5×4 grid, 10 pairs) because you met both Easy targets (24 moves or fewer and 90 seconds or less)."

The decision logic is a pure function in [`src/utils/difficulty.ts`](src/utils/difficulty.ts); deck generation is in [`src/utils/gameLogic.ts`](src/utils/gameLogic.ts).

## Dark theme

The interface uses a dark charcoal theme with a restrained violet accent. All colours are CSS custom properties at the top of [`src/index.css`](src/index.css), so the palette can be changed in one place.

- **Cards:** face-down cards are dark with a visible border and an accent-coloured hover state; revealed cards are light with dark symbols for strong contrast; matched cards turn green and show a check mark, so matching is not signalled by colour alone. The flip animation is unchanged.

- **Buttons:** Next round (shown after a win) is the filled primary button; Restart round and New game share one secondary style. All have hover, active, keyboard-focus and disabled states, and wrap to full-width rows on narrow screens.

- **Statistics and difficulty:** each level has its own labelled badge (Easy teal, Medium blue, Hard amber) and the text always names the level.

- **Result panel:** a distinct panel with a check icon. The adaptive explanation sits in an inset box marked with an up-arrow (advancing) or a return arrow (back to Easy), and the panel's border colour changes as well.

- **Accessibility:** measured contrast ratios (computed with the WCAG formula): main text on panels 14.9:1, secondary text 8.0:1, white on the primary button 5.1:1, difficulty badge text 7.0:1 or higher, face-down card border against the page 3.6:1. Focus rings are light blue (10.8:1 on the page), and `prefers-reduced-motion` disables the flip and button transitions. Semantic HTML and keyboard operation are unchanged.

- **Layout:** the board is a container that scales cards, symbols and gaps with the column count, so 4×4, 5×4 and 6×6 boards fit the available width without horizontal page scrolling. This was designed for and checked in code and automated tests only; see Known limitations.

## Screenshots

Screenshots of the Adaptive Memory Matching Game are stored in [`docs/screenshots/`](docs/screenshots/).

### Easy difficulty (4×4)
![Easy difficulty gameplay](docs/screenshots/4x4.png)

### Medium difficulty (5×4)
![Medium difficulty gameplay](docs/screenshots/5x4.png)

### Hard difficulty (6×6)
![Hard difficulty gameplay](docs/screenshots/6x6.png)

### Round completed But time Fail
![Completed round and next-level explanation](docs/screenshots/fail.png)





## Prerequisites

- Node.js 22 LTS (see `.nvmrc`; Node 20 or newer should also work) and npm 10 or newer.

- Git.

## Install and run

```bash

git clone <your-repository-url> adaptive-memory-game

cd adaptive-memory-game

npm ci

npm run dev

```

Open the URL printed by Vite (normally http://localhost:5173).

## Test, lint, type-check and build

```bash

npm run test:run     # all tests once

npm test             # tests in watch mode

npm run lint         # ESLint

npm run typecheck    # tsc --noEmit

npm run build        # type check + production build into dist/

npm run preview      # serve the production build locally

```

## Folder structure

```

.github/workflows/

  ci.yml                       CI: lint, typecheck, test, build (push + pull request)

  azure-static-web-apps.yml    Optional manual deploy workflow (not run by the author)

docs/azure-plan.md             Azure Static Web Apps plan

public/favicon.svg

src/

  components/                  GameBoard, MemoryCard, GameStats, GameControls, GameResult, SessionHistory

  hooks/useGameTimer.ts        Active-play stopwatch

  utils/

    shuffle.ts                 Seeded PRNG + Fisher-Yates shuffle

    gameLogic.ts               Deck creation and the pure game reducer

    difficulty.ts              Adaptive difficulty decision + explanation text

    sessionStorage.ts          Validated localStorage history

  config/gameConfig.ts         Symbols, thresholds, delays, policy, storage settings

  types/game.ts                Shared types

  tests/                       Vitest suites

  App.tsx, main.tsx, index.css

```

## Architecture and key decisions

- **Config-driven boards.** `createDeck(pairCount, seed?)` builds the pairs for the selected level (unique symbol per pair, unique card IDs), shuffles them, and the reducer detects the win by comparing matched pairs with half the card count. The board component reads columns and rows from the config and sets them as CSS variables, so no layout value is hard-coded for a specific grid.

- **Logic separate from UI.** All rules live in a pure reducer (`gameReducer`) with three actions: `FLIP_CARD`, `RESOLVE_MISMATCH`, `NEW_ROUND`. Components only render state and dispatch actions.

- **Consistency under rapid clicks.** Reducer updates are sequential, and `FLIP_CARD` is ignored while a mismatch is resolving, after a win, or when the card is not face down. Repeated clicks and matched cards therefore cannot change state.

- **Stale callbacks.** The mismatch timeout is created in an effect keyed on the round and cleared in its cleanup, so Restart cancels it. As a second safeguard, `RESOLVE_MISMATCH` carries a `roundId` and the reducer ignores any that do not match the current round.

- **Timer.** `useGameTimer` keeps one interval at a time, banks elapsed time when stopped, and exposes `getElapsedMs()` so the win result uses an exact value rather than the last rendered tick. It runs only while the status is `playing`.

- **One-time recording.** A ref guards the win effect so each round is evaluated and saved exactly once, including under React StrictMode.

- **Storage.** Every stored entry is validated at runtime (types, integer moves, valid date and difficulty values). Invalid JSON, wrong shapes, or a blocked `localStorage` produce an empty or filtered list instead of an error. Only the newest 50 results are kept. The session ID is a random value created per page load; no personal data is collected.

- **Best results** are derived from stored history, so clearing history also clears them.

- **Accessibility.** Cards are `<button>` elements with descriptive labels (the symbol is only announced once revealed), matched cards use `aria-disabled` so keyboard focus is not lost, the result panel is a polite live region, and animations are disabled under `prefers-reduced-motion`.

## Tests

Run with `npm run test:run`. The latest local run had **158 tests in 7 files, all passing**, and stable across repeated runs. During development one run timed out because the slowest 36-card UI tests were too close to Vitest's default 5 s limit; they now take about 2 s and the project timeout is 30 s. No coverage percentage is claimed.

| File | Covers |

| --- | --- |

| `gameConfig.test.ts` | Exact grid, pair count, card count and targets per level (24/90, 35/150, 60/300); targets grow with level; columns × rows = 2 × pairs; unique symbols; the exact adaptive policy table |

| `shuffle.test.ts` | Seeded shuffle reproducibility; for each level: correct number of pairs, exactly two cards per pair, unique IDs, shuffled order; invalid pair counts rejected |

| `gameLogic.test.ts` | Reducer for each level: board size, match, mismatch lock, win exactly at the last pair, rapid clicks, restart keeps grid size, stale callback ignored; new round switches grid size; repeat and matched-card clicks; time format |

| `difficulty.test.ts` | Easy→Medium, Medium→Hard, Hard stays Hard, every drop to Easy, inclusive boundaries for every level with literal numbers (at limit and one over, moves and time), message text, custom thresholds |

| `sessionStorage.test.ts` | Save/load, cap on stored results, clearing, corrupted JSON, invalid entries, prototype-key difficulties rejected, throwing storage, best results |

| `useGameTimer.test.ts` | Start, stop, reset, no duplicate intervals, cleanup (fake timers) |

| `App.test.tsx` | UI flows with fake timers: initial Easy board; matching rules; mismatch delay; third-card lock; timer start/stop/reset; targets shown in the instructions and stats for each level; full progression Easy→Medium→Hard with the rendered grid, card count, pair counter and instructions checked after each **Next round**; for every level, finishing in exactly the maximum moves or time meets the target and one more move or second does not; result panel outcome marker; card labels and keyboard activation; timer: single interval across re-renders, none after the win, reset on every next round; Medium/Hard→Easy on a missed time target; move-limit miss; restart on every level keeps its grid; restart during a pending mismatch on every level; new game; history across levels; corrupted storage; confirmed clear |

Tests use a seeded board (`<App initialSeed={42} />`) so card positions are known and every run is identical. A small shim in `src/tests/setup.ts` lets React Testing Library advance Vitest's fake timers.

## Sample gameplay

1. Load the page: Easy badge, 4×4 grid, 0 moves, 0 / 8 pairs, timer at 0:00.

2. Flip two cards that do not match. Both stay visible for 1 second, then flip back; moves shows 1.

3. Flip a matching pair. They turn green and stay open; pairs shows 1 / 8.

4. Find all eight pairs. The timer stops and the result panel appears, for example: "You completed the previous round in 14 moves and 38 seconds. Your next round will be Medium (5×4 grid, 10 pairs) because you met both Easy targets (24 moves or fewer and 90 seconds or less)."

5. Press **Next round (Medium)**. The board becomes 5×4 with 20 cards and the counter reads 0 / 10.

6. Meet the Medium targets to reach Hard (6×6, 36 cards, 0 / 18). Miss a target on Medium or Hard and the next round returns to Easy.

## Azure deployment

See [`docs/azure-plan.md`](docs/azure-plan.md). Live deployment is optional; nothing in the app needs Azure credentials. The deployment status of this project is: **not deployed**.

## Known limitations

- Visual appearance and keyboard behaviour were not checked in a real browser by the author (only automated jsdom tests and a successful production build were run). This includes the dark theme: check the three board sizes at desktop and phone width, the card flip, the hover/focus/disabled button states and the result panel before presenting. Contrast ratios were calculated from the colour values, not measured with a browser tool.

- The performance targets for Medium and Hard are reasonable estimates, not calibrated against real players.

- Emoji appearance depends on the operating system's emoji font.

- Elapsed time is truncated to whole seconds for both display and the difficulty rule.

- The timer keeps running if the tab is hidden mid-round (it measures wall-clock play time).

- History is per browser profile; clearing it also resets "best" values. A fresh page load always starts on Easy.

- The Azure manual-deploy workflow and the Azure plan have not been exercised against a real Azure account.

- No end-to-end browser tests and no coverage report are included.

