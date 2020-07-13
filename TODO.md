Parsing:

- [ ] fix identifier scanning like:
    `return1` scans as `[RETURN] [NUMBER 1]` instead of `[ID return1]`

- [ ] Array literals

- [x] `if` statements w/ block or w/ `then`
- [x] "post" `if` (`foo() if condition`, `return if condition` etc.)
- [ ] expression for loops like:
    `x for x in arr`
- [ ] including the weird ones like
    `x for x in xs for xs in list`
- [ ] `break` / `continue` special statements
- [ ] `else` block

- [ ] in, of, instanceof and: !in, !of, !instanceof

- [ ] assign to array / object (pattern matching)