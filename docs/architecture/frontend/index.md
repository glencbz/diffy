# Frontend

The review UI is a small [React](https://react.dev/) app. It has two commit
pickers, *before* and *after*, each drawn as a commit graph, and one diff panel.
Pick a commit on each side and the panel shows their interdiff: how the after
commit's change differs from the before commit's.

Either side takes any number of commits. Pick a whole branch on the left and
the branch it became on the right, and the panel shows one row per commit,
lined up by [`alignSeries`](../backend/series.md) and scrolled like a branch.
Reviewing a re-pushed series is the case the tool is for, and it is not a
commit-at-a-time job.

An operation selector sits above each picker. jj records every repo mutation as
an operation; picking a past one rewinds that side's log to how it looked right
after that step, via `jj ... --at-operation`. The two sides choose
independently. A commit as it stood ten operations ago and the same commit now
are exactly the pair worth comparing, and no single view of the repo holds
both.

A commit with nothing opposite it shows its own diff, whether that is because
the reader picked one side only or because the commit was added to or dropped
from the series. "Pick a commit, read its diff" is then this same screen with
an empty before side, rather than a second mode to switch into.

A pull request is the same comparison over a history nobody has locally. Every
force push replaces the branch's head, so one that has been pushed six times
has had seven heads, and its first head against its latest is exactly the
interdiff this tool is for. A switch at the top of the window chooses between
the two screens, `Local history` and `Pull requests`. Everything below that
switch is shared: the same commit graph, the same diff panel, and one `Source`
type saying where a side's commits come from.

The two screens differ because the two histories do. A jj operation log is deep
and arbitrary, so picking a point in it wants a dropdown. A pull request has
had a handful of heads in a known order, and choosing between them wants two
dropdowns of its own, one per end of the comparison.

The tech plan first sketched this in htmx. We went with React instead. The
pickers carry client-side state. Two selections drive the diff panel, and both
have to survive every reload of either side. Component state does that cleanly. htmx
would need a stack of out-of-band swaps.

## Architecture

The app has five layers plus a root. Imports point one way down this list:

```
index.html + main.tsx   mount point
        |
      App.tsx            root, owns the shared selections
        |
   controllers/          wire a state hook to a view
      /       \
 state/        views/    state/ owns data and keeps it loaded
    |    \      /        views/ turn props into markup
 api.ts   model/         api.ts: transport, fetch plus Zod, no React
                         model/: the app's own shapes and defaults
```

Each layer is named for the job it does. The `state/` modules are React hooks.
A folder called `hooks/` would say nothing, because any hook can do anything.
`state/` says what these ones are for.

The documents under this one are cut a different way. A layer is a rule about
what may import what, which is not something anyone sets out to change, so a
document is one feature instead. It holds that feature's state hook, its
controller, and its views together, and its code blocks tangle out into
`state/`, `controllers/`, and `views/` as usual. Entangled is what lets the two
trees disagree, and they should. The source tree answers what may import what.
The document tree answers what you are changing.

### transport

`api.ts` does all the talking to the backend. It knows the backend's URLs and
their wire formats. It knows nothing about React. It holds one schema and one
wrapper per endpoint, and every wrapper parses its response through that
[Zod](https://zod.dev/) schema before returning it, so a drift in a backend
shape fails at the fetch with a named parse error instead of reaching a view as
`undefined`. [Transport](transport.md) holds the inventory. Adding an endpoint
means adding a schema and a wrapper beside it and nothing else.

Two conventions run through the arguments. An optional `atOperation` is the jj
operation to read history at, and leaving it out reads the live repo. Anything
that names a commit names it by id rather than by a revset or a change id,
because an id means the same commit in every view of the repo. A pull request
head follows the same rule in git's spelling, as a `GitOid`.

### state

Each `state/` module owns one slice of the app's data and keeps it current with
the backend. `useOperations` owns the operation list. `useCommits` owns the
commit list for one side's `Source`, so there is one instance of it per side,
and it is the only place a source becomes a request. `useComparison` owns what
the diff panel shows. `usePulls` and `usePullHistory` own the pull request list
and one pull request's chain of heads. One module loads its slice, reloads it
when the input changes, and holds the loading and error state around it.

`useEffect` plus fetch plus cancel-on-change is fiddly, and it runs the same
way for every slice. It lives here once. A fetching `useEffect` appears nowhere
else.

Every hook returns an `AsyncState<T>`, the union `loading | error | ready`. A
caller switches on `status`, and the union forces it to cover every case. No
gap opens up where the load has finished but the data is still missing.
`useComparison` returns `null` when there is nothing to ask the backend for.
Its caller shows a prompt in that state.

### views

A view in `views/` is a pure function from props to markup. Give it data and
callbacks, get elements back. It never fetches or calls into `api.ts`, and
nothing in it hints that a server exists.

These are the files you restyle and test. A test renders one with fixture props
and checks the output. There is nothing to mock.

Views take the wire types from `api.ts` as props. `CommitGraph` takes
`LogEntry[]`. `DiffView` takes `FileDiff[]`. This holds while the UI shows
exactly what the API returns. When it stops matching, add view-model types and
map to them in the controllers. Until then, skip them. A copy of the wire types
only drifts from the original.

### model

A module in `model/` says what the app's own data can be and what it starts
as: a Zod schema, the type it infers, and the defaults. It holds no state,
touches no storage, and imports nothing but Zod. `api.ts` is the same kind of
module for the shapes the backend sends; `model/` is for the ones that never
cross the wire, such as [settings](settings.md#display).

A shape goes in `model/` when a view needs it and the layer that loads it is
`state/`. The view can then name the shape without reaching into the module
that owns the loading. The module holds the shape, its schema, its defaults,
and any pure function that is part of what the shape means, such as the key
it is stored under.

The pattern is meant to spread. A feature whose views name a shape its state
hook produces keeps that shape in `model/<feature>.ts` from the start, and
the hook imports it from there. A feature whose shapes all come off the wire
already has its model in `api.ts` and gets no `model/` module for symmetry.

Shapes that predate the layer still sit in `state/` beside their hooks, and
any type a view imports from `state/` is one of them. Move one into `model/`
when its feature next changes, not in a sweep of its own. Views may import
types from `state/` only until the last of them has moved. After that the
rule is that views never import `state/`.

### controllers

A controller in `controllers/` wires one state hook to one view. It calls the
hook and reads the `AsyncState`. Then it renders the view or a `Message`. It
has no markup of its own.

When there is no diff to show yet, the controller decides what goes on screen,
so `DiffView` stays at "render these files" with no null checks and one panel's
branching sits in one file. `OperationLog` drives `OperationPicker`. `CommitLog`
drives `CommitGraph`. `DiffPane` drives `InterdiffRows`.

`PullReview` bends the one-hook-one-view rule and is the only thing that does.
It mounts the commit list and the diff panel itself, because neither can be
asked for until the pull request's history has come back and said which head is
the latest. Hoisting the head into `App` would mean `App` holding a value it
cannot compute, and an effect to fill it in later.

### root

`App.tsx` holds two things per side: the `Source` its commits come from, and
which of those commits are selected. Each is read by more than one controller,
and `App` is their common parent, so `App` is where they live. `useSide` is
that pair and its two setters, written once and called twice, because the two
sides differ in nothing but which half of the comparison they feed. It is
generic over the kind of source, so a screen that only ever shows jj operations
holds a side whose source is known to be one and reaches the operation id
without a runtime check. It stays in `App.tsx` rather than `state/`, which is
for slices backed by the server; this one never touches the network.

Changing a side's source also clears its selected commits, since a commit
listed under one source need not appear under another. `ReviewPanes` handles
the layout: the two pickers as narrow columns, the diff taking the rest, and
one of the three at a time when the window is too narrow for all of them.

`App` also holds the mode switch, which pane a narrow window is showing, and
the repository the pull request screen reads. The repository is one named
constant and is the next thing here worth making configurable; a view never
sees it except as a prop.

Which screen is open, and on the pull request screen which pull request,
heads, commit, file, and line, is not React state at all but the
[address](address.md). `App` reads it through `usePlace` and hands each screen
its part. Everything else a screen holds, such as which rows are open, stays in
that screen's own state, because it says how a reader has arranged the page
rather than where they are in it.

### Keeping the boundary honest

The one-way import rule is a convention, kept by whoever writes and reviews
the import. Nothing stops a view from importing `fetchDiff` for "just one
more field". The first time that happens, the split is gone and the view
needs a running server to test again. An import that does not fit the list
below is a sign the code is in the wrong layer, and the fix is to move the
code, not to add an exception.

Allowed import edges:

- `api.ts` and `model/` import Zod only.
- `state/` imports React, `api.ts`, `model/`, and other `state/` modules. It
  imports Zod too, to parse what it reads back from `localStorage`.
- `state/pairing.ts` also imports `alignSeries` and `SeriesCommit` from
  `../../backend/commit/series`. `alignSeries` is a pure function with no
  transport and no React, so importing it needs no running server to test,
  which is what this rule exists to protect.
- `views/` imports React, other `views/`, `model/`, and *types* from `api.ts`
  and `state/`. A view is written against a view model, `ReviewedRow` or
  `RowReview`, as often as against a wire type, and a type-only import erases
  at compile time, so pulling one in from `state/` adds no runtime coupling to
  fetch or React state. The line is drawn at values, not at where a name is
  declared, so importing a *function* from `state/` is the boundary
  violation.
- `controllers/` import `state/`, `views/`, and `api.ts` *types*.
- `App.tsx` imports `controllers/`, `views/`, `model/`, `api.ts` *types*,
  and the `state/` hooks for what it holds for the whole app: the address,
  the review session, and the settings.

## Styling

The stylesheet is a stack of [cascade layers][layers], and each one may only
name the layer above it. The `@layer` statement at the top of the sheet
declares their order once, so a rule's layer decides which wins before
specificity is consulted at all.

[layers]: https://developer.mozilla.org/en-US/docs/Web/CSS/@layer

**Primitives** are the raw ramps, named for what they are. `--grey-300` says
nothing about where it is used. Changing one reshades the palette.

**Roles** map a primitive to a job. `--border` is `--grey-300`. This is the
only layer a component is allowed to name, which is what lets the palette and
the meaning move independently. Retheming the app is an edit to this layer.

**Metrics** are the tunable lengths: the spacing step, the type sizes, and
the widths of the columns. A breakpoint that only rebinds
`--pane-picker-width` cannot accidentally change a colour.

**Settings** rebinds metrics to the values a reader
[chose](settings.md#display). It sits above `metrics-narrow`, so a reader's
choice wins over a breakpoint's default.

**Components** are the classes the views use. They name roles and metrics and
never a primitive, so a component rule contains no literal a reviewer has to
decode.

Three of those have a refinement above them, named for the condition that
switches it on. `roles-dark` is the whole of dark mode, rebinding roles and
touching nothing else. `metrics-narrow` retunes the column widths in the
band under 1100px where three columns still fit. `components-narrow` is where
a rule contradicts a component instead of retuning a length: under 1000px the
panes stop being columns, the pane being read gets the window to itself, and a
field with nothing left to show gives up its room rather than truncating to a
fragment.

Each refinement gets a layer rather than a position further down its own
layer, which is what makes the order of the sheet stop mattering. Two rules
that override each other are now always in different layers, so neither
depends on being read second.

A change therefore has one address. A new brand colour is a primitive. A
caption that should be darker is a role. A column that should be wider on
large screens is a metric under a breakpoint. Nothing else needs reading.

The primitives, the roles, the metrics, and the dark theme are shared by
everything and live in [Design tokens](tokens.md). A component's rules live
with the component, in the document that holds its markup, because a class and
the element that carries it are one thing to change and were two files to find.

Each block of rules names its own layer, so the list below is an inventory
rather than an order. Two component rules meeting on the same element are
settled by specificity, as they always were, and nothing is settled by which
line of this block a reference sits on. Adding a component means adding a
reference here, anywhere.

```css
/*| id: stylesheet
/*| file: src/frontend/styles.css
@layer primitives,
  roles,
  roles-dark,
  metrics,
  metrics-narrow,
  settings,
  components,
  components-narrow;

<<design-primitives>>

<<design-roles>>

<<design-dark>>

<<design-metrics>>

<<design-responsive-metrics>>

<<design-text-size>>

<<design-app>>

<<design-settings>>

<<design-mode-tabs>>

<<design-panes>>

<<design-pane-tabs>>

<<design-message>>

<<design-operation-picker>>

<<design-commit-label>>

<<design-comparison-header>>

<<design-review-state>>

<<design-commit-graph>>

<<design-paired-graph>>

<<design-interdiff-rows>>

<<design-file-tree>>

<<design-file-navigator>>

<<design-diff-view>>

<<design-syntax>>

<<design-pull-state-chip>>

<<design-pull-list>>

<<design-pull-header>>

<<design-pull-comparison-picker>>

<<design-pull-sheet>>

<<design-commit-stack>>

<<design-responsive-panes>>
```

## Async state

Every slice reports its status as an `AsyncState<T>`.

```ts
//| id: frontend-async-state
//| file: src/frontend/state/asyncState.ts
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
```
