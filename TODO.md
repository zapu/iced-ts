Parsing:

- [ ] fix identifier scanning like:
    `return1` scans as `[RETURN] [NUMBER 1]` instead of `[ID return1]`

- [x] multiple operators with whitespace
        `+ + - +1` -> `+ (+(-(+1)));`
    - but something like this is illegal:
        `++ +i`
        `++ --i`
        `++ i++`

- [ ] prototype operators
        `@::prop`
        `this::prop`

- [x] one line multiple expressions, e.g.:
        ```
            foo = ->
                num = 10; eq  2, (num &= 3)
                num = 10; eq  2, (num |= 3)
        ```
        (this is all legal coffeescript from test/operators.coffee)

- [ ] Array literals

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

- [ ] array / object access `x[1]` `obj.x`
- [ ] assign to array / object (pattern matching)