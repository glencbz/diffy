// ~/~ begin <<docs/architecture/backend/markdown.md#backend-markdown-test>>[init]
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
// ~/~ end
