# Design tokens

Every colour, edge, and gap in the app comes from here, and the views name
what they want rather than what it looks like. A view asks for
`--text-muted`; it does not ask for `#666`. That indirection is the whole
point: the question "what grey do captions use" has one answer in one
place, and changing it changes every caption at once.

## Primitives

The ramps are the colours the app already used, sorted and named by
lightness. Nothing here is new; the values are the ones the inline styles
had, collected so that two uses of the same grey are visibly the same grey.

```css
/*| id: design-primitives
@layer primitives {
  :root {
    --grey-0: #ffffff;
    --grey-50: #fafafa;
    --grey-100: #f0f0f0;
    --grey-200: #eeeeee;
    --grey-300: #cccccc;
    --grey-500: #999999;
    --grey-600: #888888;
    --grey-700: #666666;
    --grey-900: #333333;

    --blue-100: #f4f8ff;
    --blue-200: #d0e4ff;
    --blue-600: #0969da;

    --green-100: #edf7ed;
    --green-200: #a8d5a8;
    --green-400: #63b363;
    --green-600: #1a7f37;
    --green-800: #2b6a2b;

    --red-100: #fdecec;
    --red-200: #e6a8a8;
    --red-600: #cf222e;
    --red-800: #a01b1b;

    --amber-100: #fdf5e3;
    --amber-200: #e6c98a;
    --amber-600: #bf8700;
    --amber-800: #8a5a00;

    --purple-600: #8250df;
    --teal-600: #1b7c83;
  }
}
```

The ramps carry a dark end as well as a light one. A dark theme needs
surfaces below the darkest text grey and accents bright enough to read on
them, and those are shades of the same ramps rather than a second palette.

```css
/*| id: design-primitives
@layer primitives {
  :root {
    --grey-800: #30363d;
    --grey-850: #21262d;
    --grey-950: #161b22;
    --grey-1000: #0d1117;

    --blue-400: #58a6ff;
    --blue-900: #0d2d5e;

    --green-300: #56d364;
    --green-900: #0f2a14;

    --red-400: #f85149;
    --red-900: #3d1618;

    --amber-400: #d29922;
    --amber-900: #3a2d0a;

    --purple-400: #bc8cff;
    --teal-400: #56d4dd;
  }
}
```

## Roles

A role is a sentence about the interface. `--surface-raised` is the shade a
header sits on, and the fact that it is currently the same grey as a tab
strip is a decision recorded here rather than a coincidence repeated in two
files.

The diff and review roles are kept apart from the general ones on purpose.
Added-line green and open-comment red are the app's vocabulary, not its
chrome, and a theme that wanted a colder interface would still want the
patch to read the way a patch reads everywhere else.

```css
/*| id: design-roles
@layer roles {
  :root {
    --surface: var(--grey-0);
    --surface-raised: var(--grey-100);
    --surface-sunken: var(--grey-50);
    --surface-selected: var(--blue-200);

    --border: var(--grey-300);
    --border-subtle: var(--grey-200);

    --text: var(--grey-900);
    --text-muted: var(--grey-700);
    --text-faint: var(--grey-600);
    --text-ghost: var(--grey-500);
    --text-inverse: var(--grey-0);

    --accent: var(--blue-600);
    --danger: var(--red-600);

    --diff-added: var(--green-600);
    --diff-removed: var(--red-600);
    --diff-meta: var(--grey-700);
    --diff-hunk: var(--blue-600);

    --review-open: var(--red-800);
    --review-resolved: var(--green-400);
    --review-stale: var(--amber-800);
    --review-seen-surface: var(--green-100);
    --review-seen-border: var(--green-200);
    --review-changed-surface: var(--amber-100);
    --review-changed-border: var(--amber-200);
    --review-unseen-surface: var(--blue-100);
    --review-open-surface: var(--red-100);
    --review-open-border: var(--red-200);

    --state-open: var(--green-600);
    --state-merged: var(--purple-600);
    --state-closed: var(--red-600);

    --ref-bookmark: var(--purple-600);
    --ref-tag: var(--teal-600);
    --ref-working-copy: var(--blue-600);

    --marker-working-copy: var(--blue-600);
    --marker-empty: var(--green-600);
    --marker-conflict: var(--red-600);
    --marker-divergent: var(--amber-600);
    --marker-hidden: var(--grey-500);

    --graph-lane-0: var(--grey-900);
    --graph-lane-1: var(--blue-600);
    --graph-lane-2: var(--green-600);
    --graph-lane-3: var(--purple-600);
    --graph-lane-4: var(--amber-600);
    --graph-lane-5: var(--teal-600);
    --graph-lane-6: var(--red-600);
  }
}
```

## Metrics

Spacing is a step scale rather than the free-for-all it replaces. The inline
styles used 3, 4, 5, 6, 8, 10, 12, 14, and 16 pixels, which is nine values
for about four intentions. Each one is snapped to the nearest step, so a few
gaps shift by a pixel or two and every gap afterwards is a choice between
named sizes instead of a typed-in number.

The column widths are metrics rather than numbers buried in a layout
component, and that is what makes the breakpoints below a two-line change.

```css
/*| id: design-metrics
@layer metrics {
  :root {
    --space-1: 2px;
    --space-2: 4px;
    --space-3: 6px;
    --space-4: 8px;
    --space-5: 12px;
    --space-6: 16px;
    --space-7: 24px;

    --font-mono: ui-monospace, monospace;
    --text-size: 13px;
    --text-size-small: 11px;
    --text-line-height: 1.4;

    --radius: 3px;
    --radius-large: 8px;

    --pane-picker-width: 25%;
    --pane-picker-min: 240px;
    --pane-list-width: 22%;
    --pane-list-min: 220px;
    --pane-commits-width: 360px;
    --pane-paired-width: 640px;
    --gutter-width: 40px;
    --label-width: 56px;
    --ref-max-width: 14em;
    --border-width-accent: 3px;
  }
}
```

## Responsiveness

A window too tight for three comfortable columns, and still wide enough to
keep three, gets narrower ones. That band opens at 1100 pixels and closes just
under a thousand, where [Layout](layout.md) gives up on columns altogether.
Rebinding the minimum widths retunes every pane in the band at once, because
no view and no component rule holds a width of its own.

The lower breakpoint changes the layout rather than a length, so it is not a
metric and is not here. It sits with the panes it rearranges.

```css
/*| id: design-responsive-metrics
@layer metrics-narrow {
  @media (max-width: 1100px) {
    :root {
      --pane-picker-min: 180px;
      --pane-list-min: 160px;
      --pane-commits-width: 260px;
      --pane-paired-width: 460px;
    }
  }
}
```

A phone is short of width in the same way and has one length left to give.
Forty pixels stands a line number well clear of the patch, which is worth it
beside a diff that has the room; twenty-eight still holds the numbers a file
has and hands the difference to the code, which does not.

```css
/*| id: design-responsive-metrics
@layer metrics-narrow {
  @media (max-width: 480px) {
    :root {
      --gutter-width: 28px;
    }
  }
}
```

## Dark theme

Dark mode rebinds roles and touches nothing else. No component rule, no
breakpoint, and no view changes, which is the claim the layering makes and
the reason it is worth the indirection: the whole theme is the block below.

The diff and review colours brighten rather than swap. A patch reads the way
a patch reads everywhere, so added stays green and removed stays red, at a
lightness that survives a dark surface.

```css
/*| id: design-dark
@layer roles-dark {
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: var(--grey-1000);
      --surface-raised: var(--grey-950);
      --surface-sunken: var(--grey-850);
      --surface-selected: var(--blue-900);

      --border: var(--grey-800);
      --border-subtle: var(--grey-850);

      --text: var(--grey-100);
      --text-muted: var(--grey-500);
      --text-faint: var(--grey-600);
      --text-ghost: var(--grey-700);
      --text-inverse: var(--grey-1000);

      --accent: var(--blue-400);
      --danger: var(--red-400);

      --diff-added: var(--green-300);
      --diff-removed: var(--red-400);
      --diff-meta: var(--grey-600);
      --diff-hunk: var(--blue-400);

      --review-open: var(--red-400);
      --review-resolved: var(--green-300);
      --review-stale: var(--amber-400);
      --review-seen-surface: var(--green-900);
      --review-seen-border: var(--green-600);
      --review-changed-surface: var(--amber-900);
      --review-changed-border: var(--amber-600);
      --review-open-surface: var(--red-900);
      --review-open-border: var(--red-600);
      --review-unseen-surface: var(--blue-900);

      --state-open: var(--green-300);
      --state-merged: var(--purple-400);
      --state-closed: var(--red-400);

      --ref-bookmark: var(--purple-400);
      --ref-tag: var(--teal-400);
      --ref-working-copy: var(--blue-400);

      --marker-working-copy: var(--blue-400);
      --marker-empty: var(--green-300);
      --marker-conflict: var(--red-400);
      --marker-divergent: var(--amber-400);
      --marker-hidden: var(--grey-600);

      --graph-lane-0: var(--grey-100);
      --graph-lane-1: var(--blue-400);
      --graph-lane-2: var(--green-300);
      --graph-lane-3: var(--purple-400);
      --graph-lane-4: var(--amber-400);
      --graph-lane-5: var(--teal-400);
      --graph-lane-6: var(--red-400);
    }
  }
}
```
