# Rendering Markdown

A Markdown file reads best the way it will be shown, so the diff view offers
each side of one rendered next to its patch. Bun parses Markdown natively, `Bun.markdown.html`, with GitHub's
tables, strikethrough and task lists on by default, so rendering costs no
dependency. It is a Bun API, not a browser one, which is why the server
renders and the page only places the result.

The author of a file under review is not someone the reader has agreed to
run code from, and the page places the HTML into itself. Two things keep
what the author wrote from being more than text and links:

- Raw HTML in the source is not HTML in the output. Markdown allows it both
  as blocks and inline, and both are turned off, so a `<script>` or an
  `onerror=` reads as the characters the author typed. Every tag left is one
  the parser wrote.
- A link or image address is the one place the parser copies the author's
  text into an attribute, and `javascript:` is a valid Markdown link. Each
  `href` and `src` is kept only when it starts with a scheme on an
  allowlist, and dropped otherwise. The parser percent-encodes anything
  outside a URL's safe characters, so an address cannot hide a scheme
  behind a tab or an entity, and one that does not start with an allowed
  scheme fails closed. An image without an address has nothing to show, so
  it becomes its alt text. The attribute as the rewriter reads it is still
  escaped, and inserting text escapes it again, so the alt text is decoded
  once first. Decoding and inserting as text, rather than inserting the
  escaped attribute as HTML, keeps the output safe even if the parser ever
  left a character unescaped.

A relative address, or one naming a heading, is dropped along with the
unsafe ones. It points into the repository, or into a document the page is
not, so there is nothing at that address to open. A link opens in a new tab so following one does not leave the
review, and neither a link nor an image hands the page's address to the
site it points at.

```ts
//| id: backend-markdown
//| file: src/backend/syntax/markdown.ts

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
```

## Test

```ts
//| id: backend-markdown-test
//| file: src/backend/syntax/markdown.test.ts
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  test("renders GitHub's Markdown", () => {
    // arrange
    const source = "# Title\n\n| a |\n|---|\n| 1 |\n\n- [x] done\n";

    // act
    const html = renderMarkdown(source);

    // assert
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain('type="checkbox"');
  });

  test("shows the author's HTML as text", () => {
    // arrange
    const source =
      "<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>\n";

    // act
    const html = renderMarkdown(source);

    // assert
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  test("drops link and image addresses off the allowlist", () => {
    // arrange
    const source = [
      "[a](javascript:alert(1))",
      "[b](JaVaScRiPt:alert(1))",
      "[c](&#x6A;avascript:alert(1))",
      "[d](java&#9;script:alert(1))",
      "[e](data:text/html,x)",
      "[f](other.md)",
      "[i](#top)",
      "![g](javascript:alert(1))",
      "![h](logo.png)",
    ].join(" ");

    // act
    const html = renderMarkdown(source);

    // assert
    expect(html).not.toContain("href");
    expect(html).not.toContain("<img");
    expect(html).toContain("g h");
  });

  test("shows a dropped image's alt text exactly as the author wrote it", () => {
    // arrange
    const source = '![<script> & "Tom & Jerry" &lt;](logo.png)';

    // act
    const html = renderMarkdown(source);

    // assert
    expect(html).toBe('<p>&lt;script&gt; &amp; "Tom &amp; Jerry" &lt;</p>\n');
  });

  test("keeps web and mail links, opening them away from the review", () => {
    // arrange
    const source =
      "[a](https://example.com/?x=1&y=2) [b](mailto:a@example.com) ![d](https://example.com/d.png)";

    // act
    const html = renderMarkdown(source);

    // assert
    expect(html).toContain(
      '<a href="https://example.com/?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">a</a>',
    );
    expect(html).toContain('href="mailto:a@example.com"');
    expect(html).toContain(
      '<img src="https://example.com/d.png" alt="d" referrerpolicy="no-referrer" />',
    );
  });
});
```
