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

<<just-entangled>>

<<just-bun>>

<<just-bun-test>>

<<just-bun-typecheck>>

<<just-biome>>
```
