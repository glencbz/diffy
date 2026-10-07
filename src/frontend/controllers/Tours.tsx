// ~/~ begin <<docs/architecture/frontend/tour.md#frontend-controller-tours>>[init]
import { type ReactNode, useMemo } from "react";
import type { FileDiff } from "../model/diff";
import { guideTo } from "../model/guide";
import { GitOid } from "../model/history";
import type { LocalTourPlace, PullTourPlace, TourSpot } from "../model/place";
import { localSeries, pullSeries } from "../model/review";
import { rowAsk, type SeriesSource, versionAsk } from "../model/series";
import { buildTour, pathOf, tourFile } from "../model/tour";
import type { Visit } from "../state/place";
import { usePullHistory } from "../state/pullHistory";
import { usePulls } from "../state/pulls";
import type { ReviewHandle } from "../state/review";
import { type RowDiffs, slotKey, useRowDiffs } from "../state/rowDiffs";
import { useSeriesCommits } from "../state/series";
import { useSources } from "../state/source";
import { Message } from "../views/Message";
import { Tour } from "../views/Tour/Tour";
import { TourList } from "../views/TourList";

const NO_FILES: FileDiff[] = [];

export function LocalTours({
  place,
  review,
  onGo,
}: {
  place: LocalTourPlace | null;
  review: ReviewHandle;
  onGo: (place: LocalTourPlace | null, visit?: Visit) => void;
}) {
  if (review.status === "loading") {
    return <Message>Loading local reviews...</Message>;
  }
  const reviews = review.document.localReviews.filter(
    (local) => local.forgottenAt === undefined,
  );
  const open =
    place === null
      ? undefined
      : reviews.find((local) => local.name === place.name);
  if (place === null || open === undefined) {
    return (
      <TourList
        items={reviews.map((local) => ({
          key: local.name,
          title: local.name,
          meta: `v${local.versions.length}, ${local.versions.at(-1)?.revset ?? ""}`,
          guided: review.document.guides.some(
            (guide) =>
              guide.series === localSeries(local.name) &&
              guide.version === String(local.versions.length),
          ),
        }))}
        empty="Nothing is registered for review yet."
        onSelect={(name) => onGo({ name, commit: null })}
      />
    );
  }
  const versionId = String(open.versions.length);
  return (
    <TourOf
      key={`${open.name}@${versionId}`}
      source={{ kind: "local", review: open }}
      series={localSeries(open.name)}
      versionId={versionId}
      guides={review.document.guides}
      spot={place}
      onGo={(spot, visit) => onGo({ ...spot, name: open.name }, visit)}
      header={
        <TourHeader
          title={open.name}
          meta={`v${versionId}, ${open.versions.at(-1)?.revset ?? ""}`}
          onBack={() => onGo(null)}
          classic={`/reviews/${encodeURIComponent(open.name)}`}
        />
      }
    />
  );
}

export function PullTours({
  place,
  review,
  onGo,
}: {
  place: PullTourPlace | null;
  review: ReviewHandle;
  onGo: (place: PullTourPlace | null, visit?: Visit) => void;
}) {
  const pulls = usePulls();
  if (pulls.status === "loading") {
    return <Message>Loading pull requests...</Message>;
  }
  if (pulls.status === "error") {
    return <Message tone="error">{pulls.message}</Message>;
  }
  const { repo } = pulls.data;
  if (place === null) {
    return (
      <TourList
        items={pulls.data.pulls.map((pull) => ({
          key: String(pull.number),
          title: `#${pull.number} ${pull.title}`,
          meta: `${pull.state.toLowerCase()}, ${pull.author}`,
          guided: review.document.guides.some(
            (guide) =>
              guide.series === pullSeries(repo, pull.number) &&
              guide.version === pull.headRefOid,
          ),
        }))}
        empty="This repository has no pull requests."
        onSelect={(key) => onGo({ number: Number(key), commit: null })}
      />
    );
  }
  // The list holds the newest pull requests only, and an older one opened
  // by its address still reads, without the title the list would give it.
  const { number } = place;
  const open = pulls.data.pulls.find((pull) => pull.number === number);
  return (
    <PullTour
      key={number}
      repo={repo}
      number={number}
      header={
        <TourHeader
          title={`#${number} ${open?.title ?? ""}`}
          meta={
            open === undefined
              ? ""
              : `${open.state.toLowerCase()}, ${open.author}`
          }
          onBack={() => onGo(null)}
          classic={`/pulls/${number}`}
        />
      }
      review={review}
      spot={place}
      onGo={(spot, visit) => onGo({ ...spot, number }, visit)}
    />
  );
}

function PullTour({
  repo,
  number,
  header,
  review,
  spot,
  onGo,
}: {
  repo: string;
  number: number;
  header: ReactNode;
  review: ReviewHandle;
  spot: TourSpot;
  onGo: (spot: TourSpot, visit?: Visit) => void;
}) {
  const history = usePullHistory(repo, number);
  if (history.status === "loading") {
    return <Message>Loading versions...</Message>;
  }
  if (history.status === "error") {
    return <Message tone="error">{history.message}</Message>;
  }
  const newest = history.data.states.at(-1);
  if (newest === undefined) {
    return <Message tone="error">This pull request has had no head.</Message>;
  }
  return (
    <TourOf
      key={newest.head}
      source={{ kind: "pull", repo, number }}
      series={pullSeries(repo, number)}
      versionId={newest.head}
      guides={review.document.guides}
      spot={spot}
      onGo={onGo}
      header={header}
    />
  );
}

function TourHeader({
  title,
  meta,
  onBack,
  classic,
}: {
  title: string;
  meta: string;
  onBack: () => void;
  classic: string;
}) {
  return (
    <div className="tour-title">
      <button type="button" className="tour-link" onClick={onBack}>
        all
      </button>
      <strong className="tour-title__name">{title}</strong>
      <span className="tour-title__meta">{meta}</span>
      <a className="tour-link" href={classic}>
        classic view
      </a>
    </div>
  );
}

function filesOf(diffs: RowDiffs, id: string | null | undefined): FileDiff[] {
  const found =
    id == null ? undefined : diffs.get(slotKey({ left: null, right: id }));
  return found?.status === "ready" ? found.data : NO_FILES;
}

/** The newest version of one series, read as a tour. */
function TourOf({
  source,
  series,
  versionId,
  guides,
  spot,
  onGo,
  header,
}: {
  source: SeriesSource;
  series: string;
  versionId: string;
  guides: ReviewHandle["document"]["guides"];
  spot: TourSpot;
  onGo: (spot: TourSpot, visit?: Visit) => void;
  header: ReactNode;
}) {
  const ask = useMemo(() => versionAsk(source, versionId), [source, versionId]);
  const commits = useSeriesCommits(ask);
  const slots = useMemo(
    () =>
      commits.status === "ready"
        ? commits.data.map((commit) => ({ left: null, right: commit.commitId }))
        : [],
    [commits],
  );
  const diffs = useRowDiffs(rowAsk(source, { kind: "base" }, versionId), slots);
  const guide = guideTo(guides, series, versionId);

  const list = commits.status === "ready" ? commits.data : [];
  const commitId = spot.commit ?? list[0]?.commitId ?? null;
  const wanted = useMemo(() => filesOf(diffs, commitId), [diffs, commitId]);
  const lookup = useSources(wanted);

  const loaded = list.map((commit) =>
    diffs.get(slotKey({ left: null, right: commit.commitId })),
  );
  const failed = loaded.find((state) => state?.status === "error");
  const ready =
    commits.status === "ready" &&
    loaded.every((state) => state?.status === "ready");

  const tour = useMemo(() => {
    if (!ready) return null;
    return buildTour(
      list.map((commit) => ({
        commitId: commit.commitId,
        description: commit.description,
        files: filesOf(diffs, commit.commitId).map((file) => {
          const blob = file.newBlob;
          const length =
            blob === null
              ? null
              : (lookup(blob, pathOf(file))?.lines.length ?? null);
          return tourFile(file, length);
        }),
      })),
      guide,
    );
  }, [ready, diffs, lookup, guide, list]);

  if (commits.status === "loading")
    return <Message>Loading commits...</Message>;
  if (commits.status === "error") {
    return <Message tone="error">{commits.message}</Message>;
  }
  if (failed?.status === "error") {
    return <Message tone="error">{failed.message}</Message>;
  }
  if (tour === null || commitId === null) {
    return <Message>Loading {list.length} commits...</Message>;
  }
  return (
    <Tour
      tour={tour}
      commitId={commitId}
      onGo={(commit: string) => onGo({ commit: GitOid.parse(commit) })}
      source={lookup}
      header={header}
      guidedBy={
        guide === undefined
          ? null
          : `Guide by ${guide.author}, ${guide.writtenAt.slice(0, 10)}`
      }
    />
  );
}
// ~/~ end
