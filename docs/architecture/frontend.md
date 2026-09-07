# Frontend

For science, we use [htmx](https://htmx.org/) over a JS frontend framework.
We'll render all of Diffy's UI via the server and just let the Bun backend
handle everything.

## Landing page

The landing page is an [HTML import](https://bun.com/docs/bundler/fullstack):
Bun's bundler scans it for `<script>`/`<link>` tags and bundles them, then
`Bun.serve()` serves the result directly from the `/` route.

```html
<!--| id: landing-page
<!--| file: src/frontend/index.html
<html lang="en">
  <head>
    <title>Diffy</title>
  </head>
  <body>
    <h1>Diffy</h1>
    <button type="button" hx-get="/api/log" hx-target="#result" hx-swap="innerHTML">
      Log
    </button>
    <div id="result"></div>
    <script type="module" src="./frontend.ts"></script>
  </body>
</html>
```

The entry script just needs to load htmx. We can do this just by importing it;
htmx scans the DOM for `hx-*` attributes and wires itself up on load, with no
explicit init call needed.

```ts
//| id: htmx-frontend
//| file: src/frontend/frontend.ts
import "htmx.org";
```

