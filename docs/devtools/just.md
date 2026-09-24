# Just

I love Just! It's the easiest way to run anything.

```just
#| id: justfile
#| file: justfile

_default:
  just --list

@install:
  <<just-uv-install>>
  <<just-bun-install>>

<<just-nix>>

<<just-entangled>>

<<just-docs>>

<<just-bun>>

<<just-serve>>

<<just-serve-helpers>>

<<just-bun-test>>

<<just-bun-typecheck>>

<<just-biome>>
```
