// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-screen-open-repo>>[init]
import { RepoPicker } from "../controllers/RepoPicker";

export function OpenRepoScreen({ home }: { home: string }) {
  return (
    <div className="open-repo">
      <div className="open-repo__card">
        <h1>Open a repository</h1>
        <p>
          diffy is not serving a repository. Pick one, or type a path. Next time
          diffy opens the one used last.
        </p>
        <RepoPicker home={home} current={null} />
      </div>
    </div>
  );
}
// ~/~ end
