// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-screen-open-repo>>[init]
import { RepoPicker } from "../controllers/RepoPicker";
import { tildePath } from "../model/repo";

export function OpenRepoScreen({
  home,
  startedOutside,
}: {
  home: string;
  startedOutside: string | null;
}) {
  return (
    <div className="open-repo">
      <div className="open-repo__card">
        <h1>Open a repository</h1>
        <p>
          {startedOutside === null ? (
            "diffy is not serving a repository."
          ) : (
            <>
              diffy started in <code>{tildePath(startedOutside, home)}</code>,
              which is not inside a jj repository.
            </>
          )}{" "}
          Pick one, or type a path. Next time diffy opens the one used last.
        </p>
        <RepoPicker home={home} current={null} />
      </div>
    </div>
  );
}
// ~/~ end
