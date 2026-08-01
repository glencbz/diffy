# TypeScript

There are some general libraries for TypeScript that I like for generally
adding structure, safety, convenience, etc. This doc explains the why and how
they are used.


## [Zod](https://zod.dev/)

Zod performs schema validation at runtime, which squashes TypeScript's "no
runtime validation" problem. The fact that Zod emits TypeScript types is
incredible, because that means basically seamless interop.

I've always been a fan of the [Parse, don't
validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
approach, which eliminates huge classes of bugs.
