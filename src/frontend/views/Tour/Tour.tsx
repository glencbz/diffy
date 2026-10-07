// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-tour>>[init]
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { SourceLookup } from "../../model/source";
import {
  fileOrder,
  type Span,
  type TourCard,
  type TourCommit,
  type TourIdea,
  type Tour as TourModel,
} from "../../model/tour";
import { CardView } from "./CardView";
import { Peek } from "./Peek";

/** What the reader has asked of the tour that the address does not keep. */
type Order = "story" | "file";

export interface TourProps {
  tour: TourModel;
  /** The commit on screen, which the address names. */
  commitId: string;
  onGo: (commitId: string) => void;
  source: SourceLookup;
  header: ReactNode;
  /** Who wrote the guide and when, or null for a series with none. */
  guidedBy: string | null;
}

export function Tour({
  tour,
  commitId,
  onGo,
  source,
  header,
  guidedBy,
}: TourProps) {
  const commit =
    tour.commits.find((each) => each.commitId === commitId) ?? tour.commits[0];
  const [order, setOrder] = useState<Order>("story");
  const [drawer, setDrawer] = useState(true);
  const [opened, setOpened] = useState<ReadonlyMap<string, Span[]>>(new Map());
  const [current, setCurrent] = useState<string | null>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  const cards: TourCard[] =
    commit === undefined
      ? []
      : order === "file"
        ? fileOrder(commit)
        : commit.ideas.flatMap((idea) => idea.cards);
  const currentCard =
    cards.find((card) => card.key === current) ?? cards[0] ?? null;

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

  // A new commit starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when what is read changes
  useEffect(() => {
    if (cardsRef.current !== null) cardsRef.current.scrollTop = 0;
  }, [commit?.commitId, order]);

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
        if (chosen !== undefined) onGo(chosen.commitId);
      } else if (event.key === "n" || event.key === "j") step(1);
      else if (event.key === "p" || event.key === "k") step(-1);
      else if (event.key === "o")
        setOrder(order === "story" ? "file" : "story");
      else if (event.key === " ") setDrawer(!drawer);
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

  const card = (each: TourCard, idea: TourIdea | undefined) => (
    <CardView
      key={each.key}
      card={each}
      commit={commit}
      idea={idea}
      current={each.key === currentCard?.key}
      opened={opened.get(each.key) ?? []}
      onOpen={(span) => open(each.key, span)}
      source={source}
    />
  );

  // A message card shows the message itself, so the drawer looks ahead to
  // the next file the commit reads.
  const peekCard =
    cards
      .slice(Math.max(0, cards.indexOf(currentCard as TourCard)))
      .find((each) => each.kind === "file") ?? null;

  return (
    <div className={drawer ? "tour tour--drawer" : "tour"}>
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
              onClick={() => onGo(each.commitId)}
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
      <main className="tour__cards" ref={cardsRef}>
        {order === "file" ? (
          <section className="tour-idea">
            <h2 className="tour-idea__title">
              <span className="tour-pill">{commit.number}</span>
              {commit.subject}
            </h2>
            {cards.map((each) =>
              card(
                each,
                commit.ideas.find((idea) => idea.id === each.ideaId),
              ),
            )}
          </section>
        ) : (
          commit.ideas.map((idea) => (
            <IdeaSection key={idea.id} idea={idea} commit={commit}>
              {idea.cards.map((each) => card(each, undefined))}
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
                if (next !== undefined) onGo(next.commitId);
              }}
            >
              On to commit {commit.number + 1}
            </button>
          )}
        </p>
      </main>
      <aside className="tour__drawer">
        {peekCard !== null ? (
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

function IdeaSection({
  idea,
  commit,
  children,
}: {
  idea: TourIdea;
  commit: TourCommit;
  children: ReactNode;
}) {
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
      {children}
    </section>
  );
}
// ~/~ end
