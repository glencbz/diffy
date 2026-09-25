// ~/~ begin <<docs/architecture/backend/markdown.md#backend-markdown>>[init]

/** Where a link may lead, and where an image may be loaded from. */
const SAFE_HREF = /^(https?:|mailto:)/i;
const SAFE_SRC = /^https?:/i;

/** The entities the parser writes into an attribute, and what they stand for. */
const ATTRIBUTE_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&amp;": "&",
};

/** An attribute's value as the reader should see it. */
function attributeText(raw: string): string {
  return raw.replace(
    /&(lt|gt|quot|amp);/g,
    (entity) => ATTRIBUTE_ENTITIES[entity] ?? entity,
  );
}

/** A Markdown source as HTML that carries none of the author's own markup
 *  and no address outside the allowlist. */
export function renderMarkdown(source: string): string {
  const html = Bun.markdown.html(source, {
    noHtmlBlocks: true,
    noHtmlSpans: true,
    autolinks: true,
  });

  return new HTMLRewriter()
    .on("a", {
      element(link) {
        if (!SAFE_HREF.test(link.getAttribute("href") ?? "")) {
          link.removeAttribute("href");
          return;
        }
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      },
    })
    .on("img", {
      element(image) {
        if (!SAFE_SRC.test(image.getAttribute("src") ?? "")) {
          image.replace(attributeText(image.getAttribute("alt") ?? ""));
          return;
        }
        image.setAttribute("referrerpolicy", "no-referrer");
      },
    })
    .transform(html);
}
// ~/~ end
