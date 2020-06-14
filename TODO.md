Parsing:

- [ ] fix identifier scanning like:
    `return1` scans as `[RETURN] [NUMBER 1]` instead of `[ID return1]`

- [ ] "post" `if` (`foo() if condition`, `return if condition` etc.)
- [ ] for loops including the weird ones like
    `x for x in xs for xs in list`

- [ ] in, of, instanceof and: !in, !of, !instanceof

- [ ] assign to array / object (pattern matching)