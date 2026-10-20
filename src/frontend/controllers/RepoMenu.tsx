// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-controller-repo-menu>>[init]
import { useState } from "react";
import { useRepoContext } from "../state/repo";
import { RepoSwitcher } from "../views/RepoSwitcher";
import { RepoPicker } from "./RepoPicker";

export function RepoMenu() {
  const repo = useRepoContext();
  const [open, setOpen] = useState(false);
  if (repo.served.status !== "ready") return null;
  const { home, current } = repo.served.data;
  if (current === null) return null;

  return (
    <RepoSwitcher
      home={home}
      current={current}
      open={open}
      onOpenChange={setOpen}
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
