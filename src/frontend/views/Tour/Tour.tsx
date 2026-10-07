// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-tour>>[init]
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { TourFocus } from "../../model/place";
import type { SourceLookup } from "../../model/source";
import {
  fileOrder,
  type Introduced,
  type Span,
  type TourCard,
  type TourCommit,
  type TourIdea,
  type TourLink,
  type Tour as TourModel,
} from "../../model/tour";
import { CardView, type NameLinks } from "./CardView";
import { IdeaMap } from "./IdeaMap";
import { Peek } from "./Peek";

/** What the reader has asked of the tour that the address does not keep. */
type Order = "story" | "file";

/** A card the reader is taken to once its commit is on screen. */
interface Aim {
  card: string;
  row: number | null;
}

export interface TourProps {
  tour: TourModel;
  /** The commit on screen, which the address names. */
  commitId: string;
  focus: TourFocus | null;
  onGo: (commitId: string, focus: TourFocus | null) => void;
  source: SourceLookup;
  header: ReactNode;
  /** Who wrote the guide and when, or null for a series with none. */
  guidedBy: string | null;
}

/** The ideas a link joins, read from the tour. */
function ideaIndex(tour: TourModel) {
  const ideas = new Map<string, { idea: TourIdea; commit: TourCommit }>();
  for (const commit of tour.commits) {
    for (const idea of commit.ideas) ideas.set(idea.id, { idea, commit });
  }
  return ideas;
}

export function Tour({
  tour,
  commitId,
  focus,
  onGo,
  source,
  header,
  guidedBy,
}: TourProps) {
  const ideas = useMemo(() => ideaIndex(tour), [tour]);
  const commit =
    tour.commits.find((each) => each.commitId === commitId) ?? tour.commits[0];
  const [order, setOrder] = useState<Order>("story");
  const [drawer, setDrawer] = useState(true);
  const [opened, setOpened] = useState<ReadonlyMap<string, Span[]>>(new Map());
  const [current, setCurrent] = useState<string | null>(null);
  const [aim, setAim] = useState<Aim | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const pair =
    focus?.kind === "link"
      ? { from: ideas.get(focus.from), to: ideas.get(focus.to) }
      : null;
  const narrowed =
    focus?.kind === "idea"
      ? ideas.get(focus.id)?.idea
      : focus?.kind === "link"
        ? pair?.from?.idea
        : undefined;

  const shown: TourIdea[] =
    commit === undefined
      ? []
      : narrowed !== undefined
        ? [narrowed]
        : commit.ideas;
  const cards: TourCard[] =
    commit === undefined
      ? []
      : order === "file" && narrowed === undefined
        ? fileOrder(commit)
        : shown.flatMap((idea) => idea.cards);
  const currentCard =
    cards.find((card) => card.key === current) ?? cards[0] ?? null;
  const currentIdea =
    currentCard === null ? undefined : ideas.get(currentCard.ideaId)?.idea;

  // The reading line sits a third of the way down, where the eye rests
  // while scrolling, and the card across it is the one being read.
  useEffect(() => {
    const scroller = cardsRef.current;
    if (scroller === null) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const line =
        scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
      let found: string | null = null;
      for (const element of scroller.querySelectorAll<HTMLElement>(
        "[data-card]",
      )) {
        const box = element.getBoundingClientRect();
        if (box.top <= line) found = element.dataset.card ?? null;
        if (box.bottom >= line) break;
      }
      if (found !== null) setCurrent(found);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // A new commit or a new narrowing starts at the top, unless something
  // asked to be taken to a card in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when what is read changes
  useEffect(() => {
    const scroller = cardsRef.current;
    if (scroller === null) return;
    if (aim === null) {
      scroller.scrollTop = 0;
      return;
    }
    const card = scroller.querySelector<HTMLElement>(
      `[data-card="${CSS.escape(aim.card)}"]`,
    );
    const row =
      aim.row === null
        ? null
        : card?.querySelector<HTMLElement>(`[data-row="${aim.row}"]`);
    const target = row ?? card;
    if (target != null) {
      target.scrollIntoView({ block: "center" });
      target.classList.add("tour-flash");
      setTimeout(() => target.classList.remove("tour-flash"), 1200);
      setCurrent(aim.card);
    }
    setAim(null);
  }, [commit?.commitId, JSON.stringify(focus), order]);

  const goToIdea = (id: string) => {
    const found = ideas.get(id);
    if (found === undefined) return;
    onGo(found.commit.commitId, { kind: "idea", id });
  };

  const setupNames = useMemo(
    () => nameLinks(tour, pair?.to?.commit),
    [tour, pair?.to?.commit],
  );
  const names: NameLinks = useMemo(
    () => nameLinks(tour, commit),
    [tour, commit],
  );

  const goToName = (name: Introduced) => {
    const target = tour.commits.find(
      (each) => each.commitId === name.at.commitId,
    );
    const card = target?.ideas
      .flatMap((idea) => idea.cards)
      .find(
        (each) =>
          each.kind === "file" &&
          each.path === name.at.path &&
          each.spans.some(([a, b]) => a <= name.at.row && name.at.row <= b),
      );
    if (target === undefined || card === undefined) return;
    setAim({ card: card.key, row: name.at.row });
    onGo(target.commitId, null);
  };

  const step = (by: number) => {
    const at = cards.findIndex((card) => card.key === currentCard?.key);
    const next = cards[Math.max(0, Math.min(cards.length - 1, at + by))];
    if (next === undefined) return;
    cardsRef.current
      ?.querySelector(`[data-card="${CSS.escape(next.key)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Rebinds each render, so a key reads the state it was pressed in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const digit = Number(event.key);
      if (digit >= 1 && digit <= tour.commits.length) {
        const chosen = tour.commits[digit - 1];
        if (chosen !== undefined) onGo(chosen.commitId, null);
      } else if (event.key === "n" || event.key === "j") step(1);
      else if (event.key === "p" || event.key === "k") step(-1);
      else if (event.key === "o")
        setOrder(order === "story" ? "file" : "story");
      else if (event.key === " ") setDrawer(!drawer);
      else if (event.key === "Escape" && focus !== null && commit !== undefined)
        onGo(commit.commitId, null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (commit === undefined) {
    return <p className="message">This version has no commits.</p>;
  }

  const open = (key: string, span: Span) =>
    setOpened((now) => new Map(now).set(key, [...(now.get(key) ?? []), span]));

  const card = (each: TourCard, idea: TourIdea | undefined, label: boolean) => (
    <CardView
      key={each.key}
      card={each}
      commit={commit}
      idea={label ? idea : undefined}
      current={each.key === currentCard?.key}
      opened={opened.get(each.key) ?? []}
      onOpen={(span) => open(each.key, span)}
      source={source}
      names={names}
      onName={goToName}
    />
  );

  // A message card shows the message itself, so the drawer looks ahead to
  // the next file the commit reads.
  const peekCard =
    pair?.to !== undefined
      ? null
      : (cards
          .slice(Math.max(0, cards.indexOf(currentCard as TourCard)))
          .find((each) => each.kind === "file") ?? null);

  return (
    <div
      className={[
        "tour",
        drawer ? "tour--drawer" : "",
        pair !== null ? "tour--pair" : "",
      ].join(" ")}
    >
      <header className="tour__head">
        {header}
        <nav className="tour__commits" aria-label="commits">
          {tour.commits.map((each) => (
            <button
              type="button"
              key={each.commitId}
              className={
                each.commitId === commit.commitId
                  ? "tour-commit tour-commit--current"
                  : "tour-commit"
              }
              aria-current={each.commitId === commit.commitId}
              onClick={() => onGo(each.commitId, null)}
              title={each.subject}
            >
              <span className="tour-pill">{each.number}</span>
              <span className="tour-commit__subject">{each.subject}</span>
            </button>
          ))}
        </nav>
        <div className="tour__tools">
          <span className="tour__guided">
            {guidedBy ?? "No guide yet: each file reads as its own idea"}
          </span>
          <button
            type="button"
            className="tour-toggle"
            aria-pressed={order === "file"}
            onClick={() => setOrder(order === "story" ? "file" : "story")}
            title="o"
          >
            {order === "story" ? "story order" : "file order"}
          </button>
          <button
            type="button"
            className="tour-toggle tour-toggle--drawer"
            aria-pressed={drawer}
            onClick={() => setDrawer(!drawer)}
            title="space"
          >
            whole file
          </button>
        </div>
      </header>
      <aside className="tour__map">
        <IdeaMap
          tour={tour}
          commitId={commit.commitId}
          currentIdea={currentIdea?.id ?? null}
          focus={focus}
          onCommit={(id) => onGo(id, null)}
          onIdea={goToIdea}
          onLink={(link) => {
            const from = ideas.get(link.from);
            if (from !== undefined) {
              onGo(from.commit.commitId, {
                kind: "link",
                from: link.from,
                to: link.to,
              });
            }
          }}
        />
      </aside>
      <main className="tour__cards" ref={cardsRef}>
        {focus !== null && (
          <Narrowed
            focus={focus}
            ideas={ideas}
            links={tour.links}
            onClear={() => onGo(commit.commitId, null)}
          />
        )}
        {order === "file" && narrowed === undefined ? (
          <section className="tour-idea">
            <h2 className="tour-idea__title">
              <span className="tour-pill">{commit.number}</span>
              {commit.subject}
            </h2>
            {cards.map((each) =>
              card(each, ideas.get(each.ideaId)?.idea, true),
            )}
          </section>
        ) : (
          shown.map((idea) => (
            <IdeaSection
              key={idea.id}
              idea={idea}
              commit={commit}
              ideas={ideas}
              links={tour.links}
              names={tour.names}
              onIdea={goToIdea}
            >
              {idea.cards.map((each) => card(each, idea, false))}
            </IdeaSection>
          ))
        )}
        <p className="tour__end">
          End of commit {commit.number}.{" "}
          {tour.commits[commit.number] !== undefined && (
            <button
              type="button"
              className="tour-link"
              onClick={() => {
                const next = tour.commits[commit.number];
                if (next !== undefined) onGo(next.commitId, null);
              }}
            >
              On to commit {commit.number + 1}
            </button>
          )}
        </p>
      </main>
      <aside className="tour__drawer">
        {pair?.to !== undefined ? (
          <div className="tour-setup">
            <p className="tour-setup__label">
              Set up in commit {pair.to.commit.number}
            </p>
            <IdeaSection
              idea={pair.to.idea}
              commit={pair.to.commit}
              ideas={ideas}
              links={tour.links}
              names={tour.names}
              onIdea={goToIdea}
            >
              {pair.to.idea.cards.map((each) => (
                <CardView
                  key={each.key}
                  card={each}
                  commit={pair.to?.commit ?? commit}
                  current={false}
                  opened={opened.get(each.key) ?? []}
                  onOpen={(span) => open(each.key, span)}
                  source={source}
                  names={setupNames}
                  onName={goToName}
                />
              ))}
            </IdeaSection>
          </div>
        ) : peekCard !== null ? (
          <Peek
            commit={commit}
            card={peekCard}
            opened={opened.get(peekCard.key) ?? []}
            onPull={(span) => open(peekCard.key, span)}
            source={source}
          />
        ) : (
          <div className="tour-message tour-message--whole">
            <p className="tour-setup__label">Commit {commit.number}</p>
            <pre>{commit.description}</pre>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Where each name an earlier commit introduced is used in `commit`, and
 *  the names `commit` itself introduces. */
function nameLinks(tour: TourModel, commit: TourCommit | undefined): NameLinks {
  const earlier = new Set(
    tour.commits
      .filter((each) => commit !== undefined && each.number < commit.number)
      .map((each) => each.commitId),
  );
  const numbers = new Map(
    tour.commits.map((each) => [each.commitId, each.number]),
  );
  const usable = tour.names.filter((name) => earlier.has(name.at.commitId));
  return {
    pattern:
      usable.length === 0
        ? null
        : new RegExp(
            `\\b(${usable.map((name) => name.name).join("|")})\\b`,
            "g",
          ),
    byName: new Map(usable.map((name) => [name.name, name])),
    commitNumber: (id) => numbers.get(id) ?? 0,
    preview: (name) => {
      const at = tour.commits.find(
        (each) => each.commitId === name.at.commitId,
      );
      const file = at?.files.find((each) => each.path === name.at.path);
      if (at === undefined || file === undefined) return null;
      return { commit: at, file, row: name.at.row };
    },
  };
}

function IdeaSection({
  idea,
  commit,
  ideas,
  links,
  names,
  onIdea,
  children,
}: {
  idea: TourIdea;
  commit: TourCommit;
  ideas: Map<string, { idea: TourIdea; commit: TourCommit }>;
  links: TourLink[];
  names: Introduced[];
  onIdea: (id: string) => void;
  children: ReactNode;
}) {
  const out = links.filter((link) => link.from === idea.id);
  const into = links.filter((link) => link.to === idea.id);
  const ref = (id: string, say: string, kind: TourLink["kind"]) => {
    const found = ideas.get(id);
    if (found === undefined) return null;
    return (
      <li key={`${id}:${kind}`}>
        <button
          type="button"
          className={`tour-wiki tour-wiki--${kind}`}
          onClick={() => onIdea(id)}
        >
          <span className="tour-pill">{found.commit.number}</span>
          {found.idea.title}
        </button>{" "}
        <span className="tour-wiki__say">
          {kind === "name" ? `uses ${say}` : say}
        </span>
      </li>
    );
  };
  const introduced = names.filter(
    (name) =>
      name.at.commitId === commit.commitId &&
      idea.cards.some(
        (card) =>
          card.kind === "file" &&
          card.path === name.at.path &&
          card.spans.some(([a, b]) => a <= name.at.row && name.at.row <= b),
      ),
  );
  return (
    <section
      className={idea.guided ? "tour-idea" : "tour-idea tour-idea--rest"}
      data-idea={idea.id}
    >
      <h2 className="tour-idea__title">
        <span className="tour-pill">{commit.number}</span>
        {idea.title}
        {!idea.guided && (
          <span className="tour-idea__aside">not in the guide</span>
        )}
      </h2>
      {idea.note !== "" && <p className="tour-idea__note">{idea.note}</p>}
      {out.length > 0 && (
        <div className="tour-links">
          <span className="tour-links__label">Relies on</span>
          <ul>{out.map((link) => ref(link.to, link.say, link.kind))}</ul>
        </div>
      )}
      {children}
      {(into.length > 0 || introduced.length > 0) && (
        <footer className="tour-backlinks">
          {into.filter((link) => link.kind === "guide").length > 0 && (
            <div className="tour-links">
              <span className="tour-links__label">Linked from</span>
              <ul>
                {into
                  .filter((link) => link.kind === "guide")
                  .map((link) => ref(link.from, link.say, link.kind))}
              </ul>
            </div>
          )}
          {into.filter((link) => link.kind === "name").length > 0 && (
            <div className="tour-links">
              <span className="tour-links__label">Names used in</span>
              <ul>
                {into
                  .filter((link) => link.kind === "name")
                  .map((link) => ref(link.from, link.say, link.kind))}
              </ul>
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

function Narrowed({
  focus,
  ideas,
  links,
  onClear,
}: {
  focus: TourFocus;
  ideas: Map<string, { idea: TourIdea; commit: TourCommit }>;
  links: TourLink[];
  onClear: () => void;
}) {
  const name = (id: string) => {
    const found = ideas.get(id);
    return found === undefined ? (
      id
    ) : (
      <>
        <span className="tour-pill">{found.commit.number}</span>
        {found.idea.title}
      </>
    );
  };
  const says =
    focus.kind === "link"
      ? links
          .filter((link) => link.from === focus.from && link.to === focus.to)
          .map((link) => (link.kind === "name" ? `uses ${link.say}` : link.say))
      : [];
  return (
    <div className="tour-narrowed">
      {focus.kind === "idea" ? (
        <span>Narrowed to {name(focus.id)}</span>
      ) : (
        <span>
          {name(focus.from)} relies on {name(focus.to)}
          {says.length > 0 && (
            <span className="tour-narrowed__say">: {says.join("; ")}</span>
          )}
        </span>
      )}
      <button type="button" className="tour-link" onClick={onClear}>
        whole commit
      </button>
    </div>
  );
}
// ~/~ end
