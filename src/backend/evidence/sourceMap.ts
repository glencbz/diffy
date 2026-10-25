// ~/~ begin <<docs/architecture/backend/runs.md#backend-evidence-source-map>>[init]
import * as z from "zod";

const SourceMapFile = z.object({
  version: z.literal(3),
  sourceRoot: z.string().optional(),
  sources: z.array(z.string().nullable()),
  mappings: z.string(),
});

export interface SourceMap {
  /** Each source's address, the source root already in front. */
  sources: string[];
  mappings: string;
}

/** A map's text read, or null when it is not one this can read. */
export function readSourceMap(text: string): SourceMap | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = SourceMapFile.safeParse(json);
  if (!parsed.success) return null;
  const root = parsed.data.sourceRoot ?? "";
  const joined = root === "" || root.endsWith("/") ? root : `${root}/`;
  return {
    sources: parsed.data.sources.map((source) => `${joined}${source ?? ""}`),
    mappings: parsed.data.mappings,
  };
}

/** Where a run of generated characters came from, counting from 0. */
export interface Segment {
  column: number;
  /** Null for characters that came from no source. */
  source: number | null;
  line: number;
}

const DIGITS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The segments of each generated line, in column order. */
export function decodeMappings(mappings: string): Segment[][] {
  const out: Segment[][] = [[]];
  // Every field is relative to the one before it; only the generated
  // column starts again on each line.
  let column = 0;
  let source = 0;
  let line = 0;
  let fields: number[] = [];
  let value = 0;
  let shift = 0;
  const end = () => {
    const [generated, toSource, toLine] = fields;
    if (generated === undefined) return;
    column += generated;
    if (toSource !== undefined && toLine !== undefined) {
      source += toSource;
      line += toLine;
      out.at(-1)?.push({ column, source, line });
    } else {
      out.at(-1)?.push({ column, source: null, line: 0 });
    }
    fields = [];
  };
  for (const char of mappings) {
    if (char === ",") {
      end();
    } else if (char === ";") {
      end();
      out.push([]);
      column = 0;
    } else {
      const digit = DIGITS.indexOf(char);
      value += (digit & 31) << shift;
      if (digit & 32) {
        shift += 5;
      } else {
        fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
        value = 0;
        shift = 0;
      }
    }
  }
  end();
  return out;
}

/** 1 for each character that ran and is not blank: later ranges sit
 *  inside earlier ones and decide their characters. */
export function ranChars(
  text: string,
  ranges: { startOffset: number; endOffset: number; count: number }[],
): Uint8Array {
  const counts = new Int32Array(text.length).fill(-1);
  for (const range of ranges) {
    counts.fill(
      range.count,
      range.startOffset,
      Math.min(range.endOffset, text.length),
    );
  }
  const ran = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (
      (counts[at] ?? 0) > 0 &&
      char !== " " &&
      char !== "\t" &&
      char !== "\r" &&
      char !== "\n"
    ) {
      ran[at] = 1;
    }
  }
  return ran;
}

/** The original lines, counting from 1, that ran, by index into the map's
 *  sources. */
export function mappedLinesRun(
  text: string,
  ranges: { startOffset: number; endOffset: number; count: number }[],
  map: SourceMap,
): Map<number, Set<number>> {
  const ran = ranChars(text, ranges);
  const out = new Map<number, Set<number>>();
  let start = 0;
  for (const segments of decodeMappings(map.mappings)) {
    if (start > text.length) break;
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    for (const [index, segment] of segments.entries()) {
      if (segment.source === null) continue;
      const from = start + segment.column;
      const to = Math.min(
        end,
        start + (segments[index + 1]?.column ?? end - start),
      );
      if (from < to && ran.subarray(from, to).includes(1)) {
        const lines = out.get(segment.source) ?? new Set<number>();
        lines.add(segment.line + 1);
        out.set(segment.source, lines);
      }
    }
    start = end + 1;
  }
  return out;
}
// ~/~ end
