// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-view-idea-map>>[init]
import { useState } from "react";
import type { TourFocus } from "../../model/place";
import type { Tour, TourLink } from "../../model/tour";

const ROW = 24;
const HEAD = 30;
const GUTTER = 64;

interface Placed {
  id: string;
  commitId: string;
  y: number;
}

/** Every commit's ideas in one column, a commit's under its heading, with an
 *  arc in the gutter for each link between two of them. */
export function IdeaMap({
  tour,
  commitId,
  currentIdea,
  focus,
  onCommit,
  onIdea,
  onLink,
}: {
  tour: Tour;
  commitId: string;
  currentIdea: string | null;
  focus: TourFocus | null;
  onCommit: (commitId: string) => void;
  onIdea: (id: string) => void;
  onLink: (link: TourLink) => void;
}) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const placed = new Map<string, Placed>();
  const heads: {
    commitId: string;
    number: number;
    subject: string;
    y: number;
  }[] = [];
  const folds: { commitId: string; count: number; y: number }[] = [];
  const shown = new Set<string>();
  let y = 0;
  for (const commit of tour.commits) {
    heads.push({
      commitId: commit.commitId,
      number: commit.number,
      subject: commit.subject,
      y,
    });
    y += HEAD;
    // A guided commit folds the files its guide leaves out into one row,
    // where their arcs meet.
    const guided = commit.ideas.some((idea) => idea.guided);
    const folded = guided && !unfolded.has(commit.commitId);
    const rest = commit.ideas.filter((idea) => !idea.guided);
    for (const idea of commit.ideas) {
      if (folded && !idea.guided) continue;
      placed.set(idea.id, {
        id: idea.id,
        commitId: commit.commitId,
        y: y + ROW / 2,
      });
      shown.add(idea.id);
      y += ROW;
    }
    if (guided && rest.length > 0) {
      folds.push({ commitId: commit.commitId, count: rest.length, y });
      for (const idea of folded ? rest : []) {
        placed.set(idea.id, {
          id: idea.id,
          commitId: commit.commitId,
          y: y + ROW / 2,
        });
      }
      y += ROW;
    }
  }
  const height = y + 4;
  const biggest = Math.max(
    1,
    ...tour.commits.flatMap((commit) => commit.ideas.map((idea) => idea.size)),
  );

  const lit = focus?.kind === "idea" ? focus.id : currentIdea;
  const near = new Set(
    tour.links
      .filter((link) => link.from === lit || link.to === lit)
      .flatMap((link) => [link.from, link.to]),
  );
  // One arc per pair of ideas, however many links join them.
  const arcs = new Map<string, TourLink[]>();
  for (const link of tour.links) {
    const key = `${link.from}\n${link.to}`;
    arcs.set(key, [...(arcs.get(key) ?? []), link]);
  }

  return (
    <div className="idea-map">
      <svg
        className="idea-map__arcs"
        width={GUTTER}
        height={height}
        role="img"
        aria-label="links between ideas"
      >
        {[...arcs.values()].map((links) => {
          const [link] = links;
          if (link === undefined) return null;
          const from = placed.get(link.from);
          const to = placed.get(link.to);
          if (from === undefined || to === undefined) return null;
          const reach = Math.min(
            GUTTER - 6,
            10 + Math.abs(from.y - to.y) * 0.22,
          );
          const x = GUTTER - 2;
          const path = `M ${x} ${from.y} C ${x - reach} ${from.y}, ${x - reach} ${to.y}, ${x} ${to.y}`;
          const guided = links.some((each) => each.kind === "guide");
          const chosen =
            focus?.kind === "link" &&
            focus.from === link.from &&
            focus.to === link.to;
          const touches = link.from === lit || link.to === lit;
          const say = links
            .map((each) =>
              each.kind === "name" ? `uses ${each.say}` : each.say,
            )
            .join("; ");
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: an arc is a mouse target; the backlinks under each idea reach the same places by keyboard
            <g
              key={`${link.from}\n${link.to}`}
              className={[
                "idea-map__arc",
                guided ? "idea-map__arc--guide" : "idea-map__arc--name",
                chosen ? "idea-map__arc--chosen" : "",
                touches
                  ? "idea-map__arc--near"
                  : lit !== null
                    ? "idea-map__arc--far"
                    : "",
              ].join(" ")}
              onClick={() => onLink(link)}
            >
              <title>{say}</title>
              <path className="idea-map__hit" d={path} />
              <path className="idea-map__line" d={path} />
              <circle cx={x} cy={to.y} r={2.5} />
            </g>
          );
        })}
      </svg>
      <ol className="idea-map__list" style={{ height }}>
        {heads.map((head) => (
          <li
            key={head.commitId}
            className="idea-map__commit"
            style={{ top: head.y }}
          >
            <button
              type="button"
              className={
                head.commitId === commitId
                  ? "idea-map__commit-button idea-map__commit-button--current"
                  : "idea-map__commit-button"
              }
              onClick={() => onCommit(head.commitId)}
              title={head.subject}
            >
              <span className="tour-pill">{head.number}</span>
              {head.subject}
            </button>
          </li>
        ))}
        {folds.map((fold) => (
          <li
            key={`fold:${fold.commitId}`}
            className="idea-map__idea"
            style={{ top: fold.y }}
          >
            <button
              type="button"
              className="idea-map__idea-button idea-map__idea-button--rest"
              onClick={() =>
                setUnfolded((now) => {
                  const next = new Set(now);
                  if (next.has(fold.commitId)) next.delete(fold.commitId);
                  else next.add(fold.commitId);
                  return next;
                })
              }
            >
              {unfolded.has(fold.commitId)
                ? "fold the files the guide leaves out"
                : `${fold.count} files the guide leaves out`}
            </button>
          </li>
        ))}
        {tour.commits.flatMap((commit) =>
          commit.ideas.map((idea) => {
            const at = placed.get(idea.id);
            if (at === undefined || !shown.has(idea.id)) return null;
            const state =
              idea.id === lit
                ? "current"
                : near.has(idea.id)
                  ? "near"
                  : lit !== null
                    ? "far"
                    : "";
            return (
              <li
                key={idea.id}
                className="idea-map__idea"
                style={{ top: at.y - ROW / 2 }}
              >
                <button
                  type="button"
                  className={[
                    "idea-map__idea-button",
                    state === "" ? "" : `idea-map__idea-button--${state}`,
                    idea.guided ? "" : "idea-map__idea-button--rest",
                    commit.commitId === commitId
                      ? "idea-map__idea-button--here"
                      : "",
                  ].join(" ")}
                  aria-pressed={focus?.kind === "idea" && focus.id === idea.id}
                  onClick={() => onIdea(idea.id)}
                  title={idea.title}
                >
                  <span className="idea-map__title">{idea.title}</span>
                  <span
                    className="idea-map__size"
                    style={{
                      width: `${Math.max(2, (idea.size / biggest) * 36)}px`,
                    }}
                  />
                </button>
              </li>
            );
          }),
        )}
      </ol>
    </div>
  );
}
// ~/~ end
