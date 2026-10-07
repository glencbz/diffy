# Commit message style

Glen's house style, derived by drafting messages blind from diffs and diffing
them against what he actually wrote. This file is self-contained: hand it to a
subagent verbatim along with the change to describe.

## The bar

A draft is good when Glen would accept it with light edits. It is not meant
to reproduce what he would have written word for word, and no style guide
could do that. Length, subject form, opening shape, voice and what gets cut
should all land. Judgement calls will not always match his, prose against
bullets most of all, and a draft that differs there is still fine. Get these
rules right and stop; don't keep adding rules to close the last gap.

## Length budget (the rule most drafts break)

Count the diff's changed lines, then hold the body to:

| diff lines | body words |
|------------|------------|
| < 300      | 50-90      |
| 300+       | 130-210    |

There is no gradient inside those buckets. Every message under 300 changed
lines lands between 51 and 90 words whether the diff is 52 lines or 283, and
every one above lands between 133 and 207. Pick the bucket, then write to the
middle of it.

210 words is the ceiling for any change, however large. A first draft always
runs long. Draft, count the words, then cut to budget by deleting whole
thoughts rather than by shortening sentences.

## Subject

`scope: imperative summary`, lowercase after the colon, 20-46 chars. Scope is
the subarea the change touches (`views`, `server`, `review`, `skills`,
`claude`); `jj log` shows the ones in use. Lowercase after the colon means sentence case, not
de-capitalising things: acronyms, formats and proper nouns keep their case
(USDZ, PCD, SDF, RoomPlan, React, Blender).

Name the thing the change adds, not the activity: "add the three.js
viewport", not "fill in the scene, frame it on Home". Drop articles: "hold the scene's contents in layers", not
"hold the contents of the scene in layers". When the change has two halves,
comma-join them rather than picking one: `pass store via context, don't
export`, `remove demo cubes, init with empty layers`.

## The opening sentence

Three shapes. Pick by what the change is.

Something new: one imperative sentence with the purpose welded on by
"so that".

    Add some controls to the properties panel so that we can modify a
    layer's settings when it's selected.

A refactor or a removal: say what the code does now and what's wrong with it,
then give the imperative fix. Do not lead with the fix.

    state/store.ts exported the store instance, so any file that wanted the
    store could just import it directly. However, direct importing like this
    tends to create pretty nasty hidden dependencies between files and hurts
    testability. Put a stop to all of this by not exporting the store at all.

Groundwork for a later commit: front the purpose with "To ...".

    To prepare for loading actual data, remove the placeholder "demo" layer
    that we've been using to test all of our functionality.

## Voice

A developer explaining the change to a colleague who knows the repo but
wasn't watching this work. First-person plural, relaxed, willing to judge.

- "we", "we'll", "we don't exactly need this now, but it'll be useful for
  when we load data in subsequent commits".
- Mild casual qualifiers, used sparingly: "pretty straightforward", "mostly",
  "actually", "finally", "simply", "quite legible", "yet another". Mild is
  the point. No vivid metaphors, no jokes, nothing showy.
- British spelling: colour, initialise, reorganise, behaviour.
- "Teach the <thing> how to <handle the new case>" whenever the change
  extends something existing to a new input. Reach for this before inventing
  a phrasing. Where a change teaches several existing pieces the same new
  case, give each its own bullet in that form.
- Name deferred work in one plain sentence: "We haven't added pcd loading
  yet, but we will soon"; "we'll hold off on that refactor until we find a
  better home for it".
- Tests read as validating the change: "Add functionality to set the entire
  layer state, and unit test that"; "Test this by turning the boxes from a
  plain group into a layer". Never "plus a unit test".
- ASCII only. Write `store -> view`, `<Node/>` and `&` literally. No Unicode
  arrows, no em dashes, and never HTML entities (`&lt;`, `&amp;`).
- JSX element names go bare: `<Node/>`, `<Canvas>`, `<App>`. Backticks around
  paths and identifiers are optional; use them lightly or not at all.
- Wrap at 72 chars.

## Sentence by sentence

Robotic, tightly packed prose is hard to parse even when it is correct.

- Prefer several short sentences to one long multi-clause one. Full stops are
  the main tool for keeping clauses identifiable.
- Never stack technical terms in quick succession. Unpack compound jargon
  into a plain description: "the post-asset-removal fused mesh" reads better
  as "the fused mesh right after fusion, with the assets already removed".
- At most one parenthetical per clause. When a sentence wants a second aside,
  promote one to its own sentence. Don't chain asides for the sake of
  brevity.
- State cause and effect directly, and drop a pronoun whose referent isn't
  instantly obvious. "its consumer" should name the consumer.
- Active voice, and personal pronouns where they read more plainly: "We tried
  a nearest-neighbor metric first and rejected it" beats "a nearest-neighbor
  metric was tried first and rejected".
- Where density is unavoidable, punctuate hard: full stops, one item per
  bullet, and parentheses for asides (mechanics, examples, identifiers)
  rather than chained comma clauses.

## Clauses and subjects

The tells Glen catches most often are all clause-level. Read each sentence
once, at speed, and see whether it parses on that pass.

- Keep the relativizer. A noun followed straight away by a new subject and
  verb ("the pattern the loaders set", "a mesh we can't find", "the
  sub-fetches a loader makes") reads as that verb's own subject, so the
  reader has to back up when the real verb lands. Put `that` or `which` back,
  or drop the clause and let the noun stand alone.
- One relative clause per sentence at most, and never two nested. When a
  sentence wants a second, start a new sentence.
- Give every clause a subject that performs its verb. "A mesh we can't find
  keeps the placeholder box and says so in the log" hangs a second verb on a
  subject that never did it: the mesh does not say anything, we log it. Write
  "A mesh that we can't find keeps the placeholder box, and we log the miss."
  Watch a subject carried across "and", "so" or a comma into a clause where
  it no longer fits.
- A copula hides that fault. "x is its length and leaves width and height
  alone" reads as "a length leaves width and height alone", because "is its
  length" has redefined what the second verb attaches to. Give the subject
  one verb it can perform: "x changes the box's length and leaves its width
  and height alone."
- Don't hand an inanimate subject a verb only a person can do. A world does
  not "show nothing of itself". Name what really acts: the loader, the
  viewport, the outliner, or us.
- No -ing clause trailing off the end ("..., learning them from a cookie").
  Give it its own subject and its own sentence.

Three ways a fix goes too far, each worse than the sentence it replaced:

- Don't replace a working pronoun with a repeated noun. "it", "them" and
  "its" are correct when the referent is the nearest preceding subject and
  nothing competes. "so the hidden subtree would otherwise swallow clicks
  meant for what's behind the subtree" is worse than "behind it". Never
  repeat a filename or an identifier where a pronoun is clear:
  "libs/resources.ts resolves a URI the way Gazebo does: it looks for ..."
  not "libs/resources.ts resolves ... : libs/resources.ts looks for ...".
- Don't chop a real sequence into staccato sentences. Steps sharing one
  subject stay in one sentence: "parse the file into a plain SdfWorld, pass
  that into the scene graph, and teach the <Node/> component to draw the new
  shapes" is right as it stands.
- Don't add a connective the draft didn't have. No "As a result", "Even so",
  "Therefore", "In turn". A reason stays a reason and a consequence stays a
  consequence.

A sentence that already parses on the first read is finished. Leaving it
alone is the correct edit.

## Prose or bullets

Half of these messages have no bullets at all, and it does not track the size
of the change: a 525-line commit runs as three plain paragraphs while an
83-line one uses two bullets. What decides it is the shape of the change.

Prose when the change is one idea developed: unifying two display options
into one object, moving the store behind a context.

Prose also when the change repeats a pattern an earlier commit already
established. Say so and walk the pipeline in one sentence, rather than
re-bulleting the same structure: "This mostly follows the pattern established
by the PCD loader: we use the built in USDLoader to parse it into a
RoomPlanScene, pass that into the scene graph, and then teach the <Node/>
component to render the new type." Bullet the modules when the change
*establishes* them, not when it follows them. This prose form is for a change
that slots into structure the repo already has. A change that follows an
earlier pattern *and* adds new structure of its own still bullets the new
parts.

Bullets when the change is a set of pieces the reader meets separately:

- independent halves that happen to ship together,
- the tools or patterns a first-of-its-kind change establishes,
- the existing components a new case has to be taught,
- the new modules or directories the change introduces, each named with its
  job. This is the strongest bullet signal: if the change adds a directory or
  module the repo did not have, bullet them and say what each is for.

Mechanics:

- `*` markers, blank line between bullets.
- The line introducing them ends with a colon and says something real. "Don't
  implement any real logic yet; simply scaffold it with the tools we want:"
  is a framing sentence. "The pieces:" and "How it fits together:" are
  labels; never write those. When the change is the first of its kind, the
  framing sentence should say so and the bullets are the patterns it sets up:
  "As this is the first loader, establish some patterns that we'll reuse for
  future loaders:".
- Each bullet is 1 to 3 wrapped lines. Most are one sentence: "The eye on
  each row hides that node, and children inherit the hidden state." At most
  one bullet in the message gets an indented second paragraph.
- One concept per bullet, ordered as a reader would meet them.
- A change with two distinct concerns wants two bullet groups, each under its
  own framing sentence, rather than one long list: "Reorganise the Viewport
  component to account for this added complexity:" then "To handle hotkeys,
  we add a bunch of new glue code to put things in the right place:".
- A secondary piece can be a bare one-sentence paragraph with no elaboration
  at all: "Add some display options for USDZ." Don't pad it out.

## Altitude

The message accounts for every change in the commit, at the altitude of
objective and rationale. Aim it at a reader who wants to know what this
commit is for and why it touches what it touches.

Do not narrate code-level mechanics. Name a specific function, parameter, or
deletion only when that particular detail would surprise the reader or is the
one thing they need to look at.

Negative: `Change functionX() to accept Y param, delete functionY().`

Positive: `Introduce UI feature X. It needs progress from subsystem A, so
write the plumbing for that.`

## What earns a place

The reason for the change, and the decisions a reader could not recover from
the diff.

Keep the reason behind a piece of code when it guards against a specific
failure the reader would not predict. Name the failure.

    The drop listeners go on the document rather than the canvas, so a file
    let go over the outliner or the properties panel still counts.

    This implementation counts the pairs of dragenter/dragleave, because a
    drag crossing into a child element fires a leave for the parent, and
    without the count the overlay flickers on every hop.

Cut the same kind of detail when it is merely how the library works, or when
the code would read as obviously correct anyway. The test is whether a
competent reader would have written it differently and been bitten.

Where the change adds indirection that isn't justified yet, say so plainly
instead of defending it. Being straight about a design that may be premature
is in voice; arguing for it is not.

    This is mostly for future-proofing against the case where we need to
    share state outside of three.js, since in this current state, there's
    nothing stopping us from just binding hotkeys under <Canvas>.

Keep a design choice when the alternative was real and the reason is short.

    Since this would add yet another display option to (hidden, selected),
    combine them into a single Look object that we can pass around via props.

A dependency the change adds gets "We choose X because:" and bullets naming
what it buys this project. Never its API or internals: "it keeps all of the
view logic in React" earns its place, "<Canvas> owns the WebGL renderer and
the render loop" does not.

## What to cut

Cut on sight, even when true, even when you found it interesting:

- Anything recoverable by reading the diff, and any restatement of what a
  name already says.
- Inventories of files the change merely edited. (Naming *new* modules by
  their job is fine, that is a bullet form above.)
- Type-system mechanics: exhaustiveness checks, `assertNever`, branded types,
  what becomes a compile error.
- Serialisation and data-layout trivia: array orderings, hex int encodings,
  JSON round trips.
- Render-performance and re-render-granularity asides.
- CI and test-runner wiring.
- Rejected alternatives, unless the choice was genuinely close and the reason
  fits in a clause.
- Speculation about future callers, or shapes the code might take later.
- Any paragraph defending a decision this change removes. Delete it, don't
  update it.
- The message's own history. No "as noted above", no "that settles the split
  described earlier". Every message reads as if written once, for the change
  as it now stands.

Config and endpoint plumbing gets at most one clause naming what was added
("Support this by adding a /api/config to the bun backend, and a frontend
client to call it"), never an explanation of why it was necessary.

Decisions about version pins and hardcoded values belong in a comment next to
the pin, or in the README. If they aren't commented yet, add the comment as
part of the change instead of narrating it here.

Assume the reader knows the repo's purpose and whatever an earlier commit
introduced. Assume this repo is their first contact with the individual
technologies in it: introduce each by the job it does here, never by name
alone.

## Revising a message that already exists

When the change grows and now introduces something the subject doesn't name,
rewrite the subject rather than appending an explanation to the body: "add
React and zustand" became "add React, three.js and zustand".
