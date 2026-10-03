import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export type Side = "before" | "after";

export interface Pin {
  side: Side;
  /** Imports a module by its repo-relative path in the checkout being
   *  rendered: `before` on the before side, `after` on the after side. */
  from: (before: string, after?: string) => Promise<any>;
  render: (name: string, element: ReactElement) => void;
}

const [side, root] = process.argv.slice(2) as [Side, string];
const { default: cases } = (await import("./fixture.tsx")) as {
  default: (pin: Pin) => Promise<void> | void;
};

const out: string[] = [];
await cases({
  side,
  from: (before, after = before) =>
    import(`${root}/${side === "before" ? before : after}`),
  render: (name, element) =>
    out.push(`## ${name}\n${renderToStaticMarkup(element)}`),
});
console.log(out.join("\n"));
