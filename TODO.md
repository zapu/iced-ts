Parsing:

- [x] fix identifier scanning like:
    `return1` scans as `[RETURN] [NUMBER 1]` instead of `[ID return1]`
    - can't move forward with `operators.coffee` without this.

- [x] Array literals
    - [ ] not every variant is tested or parsed correctly, especially the
      new-line delimited arrays

- [ ] Cleanup `parseFunctionCall`, `parseAssign` (unused functions,
  functionality moved to other rule functions).

- [x] array-like access `arr[x]`, add to `parseCallsAndAccesses`.

- [x] existential operators in accesses e.g. 'foo?.bar'
    - [x] done again (redone)
    - [x] There is a wrong precedence on unary exprs vs. existential operator, e.g.
        `++a?` is parsed as `++(a?)` but should be parsed as `(++a)?`.
        Same with `a++?`, which fails to parse, but should be `(a++)?`.

- [x] multiple operators with whitespace
        `+ + - +1` -> `+ (+(-(+1)));`
    - but something like this is illegal:
        `++ +i`
        `++ --i`
        `++ i++`

- [x] prototype operators
        `@::prop`
        `this::prop`

- [ ] Fix parsing empty blocks like:
    `foo = -> ;a()`
    *should not* be parsed as `foo = () -> {}; a();` but instead error out.

- [x] one line multiple expressions, e.g.:
        ```
            foo = ->
                num = 10; eq  2, (num &= 3)
                num = 10; eq  2, (num |= 3)
        ```
        (this is all legal coffeescript from test/operators.coffee)

- [x] `if` statements w/ block or w/ `then`
- [x] "post" `if` (`foo() if condition`, `return if condition` etc.)
- [x] expression for loops like:
    `x for x in arr`
- [x] including the weird ones like
    `x for x in xs for xs in list`
- [ ] `break` / `continue` special statements
- [ ] `else` block

- [ ] `in`, `of`, instanceof and: !in, !of, !instanceof
    - [ ] `in`, `of` will definitely break some loop stuff, fix that

- [x] object access `obj.x`
- [ ] assign to array / object (pattern matching)