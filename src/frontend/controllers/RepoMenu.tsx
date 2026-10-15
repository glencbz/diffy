// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-controller-repo-menu>>[init]
import { useState } from "react";
import { useRepoContext } from "../state/repo";
import { RepoSwitcher } from "../views/RepoSwitcher";
import { RepoPicker } from "./RepoPicker";

export function RepoMenu() {
  const repo = useRepoContext();
  const [open, setOpen] = useState(false);
  if (repo.served.status !== "ready") return null;
  const { home, current, startedOutside } = repo.served.data;
  if (current === null) return null;

  return (
    <RepoSwitcher
      home={home}
      current={current}
      startedOutside={startedOutside}
      open={open}
      onOpenChange={setOpen}
      onDismissNotice={repo.dismissNotice}
    >
      <RepoPicker
        home={home}
        current={current}
        onClose={() => setOpen(false)}
      />
    </RepoSwitcher>
  );
}
// ~/~ end
