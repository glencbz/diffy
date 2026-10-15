// ~/~ begin <<docs/architecture/frontend/repos.md#frontend-controller-repo-picker>>[init]
import { useState } from "react";
import { useRepoChoices, useRepoContext, useRepoProbe } from "../state/repo";
import { RepoList } from "../views/RepoList";

export function RepoPicker({
  home,
  current,
  onClose,
}: {
  home: string;
  current: string | null;
  onClose?: () => void;
}) {
  const repo = useRepoContext();
  const choices = useRepoChoices();
  const [query, setQuery] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const probe = useRepoProbe(query);

  return (
    <RepoList
      home={home}
      current={current}
      recent={choices.recent}
      found={choices.found}
      query={query}
      probe={probe}
      failure={failure}
      forgotten={choices.forgotten}
      now={Date.now()}
      onQuery={setQuery}
      onOpen={async (path) => {
        if (path === current) return onClose?.();
        setFailure(await repo.open(path));
      }}
      onForget={choices.forget}
      onUndo={choices.undo}
      onClose={onClose}
    />
  );
}
// ~/~ end
