import { Scanner } from '../scanner'
import { Parser } from '../parser'
import * as util from 'util'

interface TestCase {
  input: string
  expected?: string
  error?: boolean | RegExp
}

function runAll(tests: TestCase[]) {
  let failCount = 0
  for (const test of tests) {
    const inputCon = test.input.replace(/\n/g, '⏎')
    try {
      // console.log(`...: ${inputCon}`)

      // TODO: Potential optimization, can create Scanner and Parser once and
      // only call `reset` on them in each test.
      const scanner = new Scanner()
      scanner.reset(test.input)
      const tokens = scanner.scan()

      const parser = new Parser()
      parser.reset(tokens)
      const nodes = parser.parse()

      const commonEmit = nodes?.debugEmitCommon()

      if (test.error) {
        console.error(`[x] Failed for input: "${inputCon}": expected error, got '${commonEmit}'`)
        failCount++
      } else if (test.expected !== commonEmit) {
        console.error(`[x] Failed for input: "${inputCon}": expected '${test.expected}' got '${commonEmit}'`)
        failCount++
      } else {
        console.log(`[+] "${inputCon}" -> '${commonEmit}'`)
      }

    } catch (err) {
      if (test.error) {
        let ok = true
        const testError = test.error
        if (util.types.isRegExp(testError) && !testError.test(err.message)) {
          console.error(`[x] Failed for input: "${inputCon}": expected error to match ${testError} but got "${err.message}"`)
          ok = false
        }

        if (ok) {
          console.log(`[+] "${inputCon} -> error as expected: "${err?.message}"`)
        }
      } else {
        console.error(`[x] Failed for input: "${inputCon}": expected '${test.expected}' got exception: ${err.message}`)
        console.error(err)
        failCount++
      }
    }
  }
  if (failCount > 0) {
    console.error(`Total ${failCount} failing test(s).`)
    return false
  }
  return true
}

const tests: TestCase[] = [
  // Math
  { input: '1 + 2 * 3', expected: '1 + 2 * 3' },
  { input: '(1 + 2) * 3', expected: '(1 + 2) * 3' },
  { input: '1 * 2 + 3', expected: '1 * 2 + 3' },

  // Also with arbitrary newlines and indent between the operator and and
  // expression.
  { input: '1 +\n2', expected: '1 + 2' },

  // Unary expressions
  { input: '-3', expected: '-3' },
  { input: '+3', expected: '+3' },
  { input: '-(2*3)', expected: '-(2 * 3)' },

  { input: '+\n\n3', expected: '+3' },
  { input: '-\n\n  3', expected: '-3' },
  { input: '-\n\n  (2+3)', expected: '-(2 + 3)' },

  { input: 'i++', expected: 'i++' },
  { input: '++i', expected: '++i' },
  { input: 'i = i++', expected: 'i = i++' },
  { input: 'i = ++i', expected: 'i = ++i' },

  // Almost implicit function calls, but targets are not identifiers or
  // parenthesized expressions, so they end up being binary operations.
  { input: '1 + 2', expected: '1 + 2' },
  { input: '1 +2', expected: '1 + 2' },
  { input: '1 -2', expected: '1 - 2' },

  // Parenthesized literals are parsed as function call targets though.
  { input: '(1) +2', expected: '(1)(+2)' },
  { input: '(1) -2', expected: '(1)(-2)' },
  // But implicit function calls still require first unary expression to have
  // no whitespace.
  { input: '(1) + 2', expected: '(1) + 2' },
  { input: 'foo + 2', expected: 'foo + 2' },

  { input: 'foo +2', expected: 'foo(+2)' },
  { input: 'foo -2', expected: 'foo(-2)' },
  { input: 'foo (+2)', expected: 'foo((+2))' },
  { input: 'foo (-2)', expected: 'foo((-2))' },

  // { input: '1 2', expected: '1(2)' }, // TODO: This one should be a parse error ("unexpected '2'")
  { input: 'foo +2, 3', expected: 'foo(+2,3)' },

  // Nested implicit function calls
  { input: 'foo +2, b 3', expected: 'foo(+2,b(3))' },
  { input: 'foo +2, b +3', expected: 'foo(+2,b(+3))' },
  { input: 'foo +2, b +3 | 0', expected: 'foo(+2,b(+3 | 0))' },
  { input: 'foo a b c', expected: 'foo(a(b(c)))' },
  { input: 'foo a b c', expected: 'foo(a(b(c)))' },

  // Other function calls
  { input: 'foo(2)', expected: 'foo(2)' },
  { input: 'foo(2, 3, 4)', expected: 'foo(2,3,4)' },
  { input: 'foo(2,\n  3,\n  4)', expected: 'foo(2,3,4)' },
  { input: 'foo(2,\n  3,\n  4\n  )', expected: 'foo(2,3,4)' },
  { input: 'foo 2,\n  3,\n  4', expected: 'foo(2,3,4)' },

  { input: '(foo 2, 3, 4)', expected: '(foo(2,3,4))' },
  { input: '(foo)(2)', expected: '(foo)(2)' },
  { input: '(foo) 2', expected: '(foo)(2)' },
  { input: '(foo) (2)', expected: '(foo)((2))' },
  { input: '(foo) (a b)', expected: '(foo)((a(b)))' },
  { input: '(foo)(a b)', expected: '(foo)(a(b))' },
  { input: '(foo)(a, b)', expected: '(foo)(a,b)' },

  { input: 'foo\n  20', error: true },
  { input: '  foo\n    20', error: true },
  { input: 'foo\n20', expected: 'foo;20' },
  { input: '  foo\n  20', expected: 'foo;20' },

  // splats
  { input: 'foo arr...', expected: 'foo(arr...)' },
  { input: 'foo 1, 2,arr...', expected: 'foo(1,2,arr...)' },
  { input: 'foo a...,b...', expected: 'foo(a...,b...)' },
  { input: 'foo(arr...)', expected: 'foo(arr...)' },
  { input: 'foo(1, 2,arr...)', expected: 'foo(1,2,arr...)' },
  { input: 'foo(a...,b...)', expected: 'foo(a...,b...)' },

  // Recursive or chained function calls (target is a function call)
  { input: '(foo())(3)', expected: '(foo())(3)' },
  { input: '(foo(2))(3)', expected: '(foo(2))(3)' },
  { input: '(foo(2)) 3', expected: '(foo(2))(3)' },

  { input: 'foo(1)(2)', expected: 'foo(1)(2)' },
  { input: 'foo(1)(2)(3)', expected: 'foo(1)(2)(3)' },
  { input: 'foo(1) +3', expected: 'foo(1)(+3)' },
  { input: 'foo bar baz 1', expected: 'foo(bar(baz(1)))' },
  { input: 'foo(1)(func 2)', expected: 'foo(1)(func(2))' },
  { input: 'foo(1)(func 2)(func 3, 4)', expected: 'foo(1)(func(2))(func(3,4))' },
  { input: '2 * hello() IF 2', expected: '2 * hello()(IF(2))' }, // unlikely typo of `if` operator

  // Combined function calls and arithmetic
  { input: 'foo(2) + 3', expected: 'foo(2) + 3' },
  { input: 'foo (2) + 3', expected: 'foo((2) + 3)' },

  // Binary functions (IN/OF) and function calls
  { input: 'x in arr', expected: 'x in arr' },
  { input: 'foo x in arr', expected: 'foo(x in arr)' },
  { input: 'foo x of obj', expected: 'foo(x of obj)' },
  { input: 'foo a, x of obj', expected: 'foo(a,x of obj)' },

  // Assignments
  { input: 'a = 2', expected: 'a = 2' },
  { input: 'a =\n\n2', expected: 'a = 2' },

  { input: 'a *= 2', expected: 'a *= 2' },
  { input: 'a ^= 2', expected: 'a ^= 2' },
  { input: 'a |= 2 | x', expected: 'a |= 2 | x' },

  { input: `foo\n20: 2`, expected: 'foo;{20: 2}' },

  // `if` / `unless` in a binary expression
  { input: 'v if v', expected: 'v if v' },
  { input: 'v() if v', expected: 'v() if v' },
  { input: 'v() if v else null', error: /Unexpected after expression: else/ },
  { input: '2 * hello() if 2', expected: '2 * hello() if 2' },
  { input: '2 * hello() unless 2', expected: '2 * hello() unless 2' },
  { input: '2 * hello() if a unless b', expected: '2 * hello() if a unless b' },
  // (Transforming the following to something emittable is outside of the scope
  // of the parser. if/unless binary expressions will behave differently wheter
  // they are alone as a statement or as an expression.)
  { input: 'a = 2 unless b', expected: 'a = 2 unless b' },
  // Seems a lot like first test case here but is totally different due to `then`.
  { input: '2 * hello() if x then 3', expected: '2 * hello()(if (x) { 3 })' },
  // `if cond` should apply to everything before, not just `z`.
  { input: 'foo x, y, z if cond', expected: 'foo(x,y,z) if cond' },
  // `z if cond` can be parentesized, though.
  { input: 'foo x, y, (z if cond)', expected: 'foo(x,y,(z if cond))' },

  // Functions
  { input: 'foo = () ->', expected: 'foo = () -> {}' },
  { input: 'foo = ->', expected: 'foo = () -> {}' },
  { input: 'foo = (a, b) ->', expected: 'foo = (a,b) -> {}' },
  { input: '(a = 1) ->', expected: '(a=1) -> {}' },
  { input: 'foo = (a = 1, b = 2) ->', expected: 'foo = (a=1,b=2) -> {}' },
  { input: 'foo = (a=1, b) ->', expected: 'foo = (a=1,b) -> {}' },
  { input: 'foo = (bar = () =>) ->', expected: 'foo = (bar=() => {}) -> {}' },

  { input: 'foo = (bar = () =>)', expected: 'foo = (bar = () => {})' },

  { input: 'foo = (c...) ->', expected: 'foo = (c...) -> {}' },
  { input: 'foo = (a...,c...) ->', expected: 'foo = (a...,c...) -> {}' },
  { input: 'foo = (a,b,c...) ->', expected: 'foo = (a,b,c...) -> {}' },

  { input: 'setTimeout (-> log(10)), 5', expected: 'setTimeout((() -> {log(10)}),5)' },
  { input: 'delay 5, (-> log(10))', expected: 'delay(5,(() -> {log(10)}))' },
  { input: 'delay 5, -> log(10)', expected: 'delay(5,() -> {log(10)})' },
  { input: 'delay -> log(10)', expected: 'delay(() -> {log(10)})' },

  { input: "foo (x) -> 'hi'", expected: "foo((x) -> {'hi'})" },

  // Blocks
  { input: 'foo = () ->\n  hello()\nhi()', expected: 'foo = () -> {hello()};hi()' },
  { input: 'foo = ->\n  hi = ->\n    a()\n', expected: 'foo = () -> {hi = () -> {a()}}' },

  // Object literals
  { input: '{"a":1}', expected: '{"a": 1}' },
  { input: '{a:1}', expected: '{a: 1}' },
  { input: '{2:1}', expected: '{2: 1}' },
  { input: '{"hi":1,a :2}', expected: '{"hi": 1, a: 2}' },

  { input: '{\n  a : 2\n}', expected: '{a: 2}' },
  { input: '{\n  a : 2\n  b : 2\n}', expected: '{a: 2, b: 2}' },
  { input: '{\n  a : 2,\n  b : 2\n}', expected: '{a: 2, b: 2}' },
  { input: '{\n  a : 2,\n  obj : {\n    b : 3\n    c : 4 }\n}', expected: '{a: 2, obj: {b: 3, c: 4}}' },
  { input: '{\n  a : 2,\n  obj : {\n    b : 3,\n    c : 4 }\n}', expected: '{a: 2, obj: {b: 3, c: 4}}' },

  {
    input: `
{
  a : 2,
  obj : {
    b : 3
    ,
    c : 4 }
}
`,
    expected: '{a: 2, obj: {b: 3, c: 4}}'
  },
  {
    input: `
{
  a : 2,
  obj : {
    b : 3
   ,
   c : 4 }
}
`,
    expected: '{a: 2, obj: {b: 3, c: 4}}'
  },
  {
    input: `
{
  a : 2,
  obj : {
    b : 3
  ,
  c : 4 }
}
`,
    expected: '{a: 2, obj: {b: 3, c: 4}}'
  },
  {
    input: `
{
  a : 2,
  obj : {
    b : 3
  ,
    c : 4 }
}
`,
    error: true
  },
  {
    input: `
{
  a : 2,
  obj : {
    b : 3
 ,
 c : 4 }
}
`,
    error: true
  },
  {
    input: `
a = {
  a : "hello"
  obj :
    2
  c : 3
}`,
    expected: 'a = {a: "hello", obj: 2, c: 3}'
  },
  {
    input: `
a = {
  a : "hello"
  obj :
  2
  c : 3
}`,
    error: true
  },
  {
    input: `
a = {
  obj : {
 c : 2
  }
}`,
    error: true,
  },
  {
    input: `
{
  a : 2
  b : {
    x : 2
}
}`,
    expected: '{a: 2, b: {x: 2}}'
  },
  {
    input: `
foo = {
  a : 2
  ,
  b : 3
  }
`,
    expected: 'foo = {a: 2, b: 3}'
  },
  {
    input: `
  {
    a : 2
  ,
  b : x
  }
`,
    expected: '{a: 2, b: x}'
  },
  {
    input: `
  {
    a : 2
 ,
  b : x
  }
`,
    error: true
  },
  {
    input: `
a =
  { a : 2, b : 3,
  c : 4 }
`,
    expected: 'a = {a: 2, b: 3, c: 4}'
  },
  {
    input: `
a =
  { a : 2, b : 3,
 c : 4 }
`,
    error: true
  },
  {
    input: `
a = b : 1,
c : 2
`,
    expected: 'a = {b: 1, c: 2}'
  },
  {
    input: `
  a = b : 1,
  c : 2
`,
    expected: 'a = {b: 1, c: 2}'
  },
  {
    input: `
a = b : 1
c : 2`,
    expected: 'a = {b: 1};{c: 2}'
  },
  {
    input: `
  a = b : 1
  c : 2`,
    expected: 'a = {b: 1};{c: 2}'
  },
  {
    input: `
    a = b : 1,
    c : 2
    hello()`,
    expected: 'a = {b: 1, c: 2};hello()'
  },
  {
    input: `
  a = b : 1,
  c : 2`,
    expected: 'a = {b: 1, c: 2}'
  },
  {
    input: `
obj =
a : 1
b : 2
c = 3`,
    expected: 'obj = {a: 1, b: 2};c = 3'
  },
  {
    input: `
  obj =
  a : 1
  b : 2
  c = 3`,
    expected: 'obj = {a: 1, b: 2};c = 3'
  },
  {
    input: `
  a = b : 1
    c : 2`,
    error: true
  },
  {
    input: `
    a = b: 1, c:2
    hello()`,
    expected: 'a = {b: 1, c: 2};hello()'
  },
  {
    input: `
  a =
    hello :
      world : 2`,
    expected: 'a = {hello: {world: 2}}'
  },
  {
    input: `
  a =
    hello :
      world : 2
    hi:
      welt: 3`,
    expected: 'a = {hello: {world: 2}, hi: {welt: 3}}'
  },
  {
    input: `
a =
  hi:
    10: 3
  a: b: c: d
`,
    expected: 'a = {hi: {10: 3}, a: {b: {c: d}}}'
  },
  {
    input: `foo hello: 'world', test: 10\nfoo2()`,
    expected: `foo({hello: 'world', test: 10});foo2()`
  },
  {
    input: `
foo
  hello : world
  'hello': 50221
  `,
    expected: `foo({hello: world, 'hello': 50221})`
  },

  // Dark Souls of language parsers
  { input: "a 1,\n2", expected: "a(1,2)" },
  { input: "  a 1,\n  2,\n  3", expected: "a(1,2,3)" },
  { input: "  a 1,\n  2,\n  3\n", expected: "a(1,2,3)" },
  { input: "  a 1,\n  2,\n    3,\n     4,\n    5", expected: "a(1,2,3,4,5)" },
  { input: "  a 1,\n  2,\n    3,\n     4,\n    5\n", expected: "a(1,2,3,4,5)" },
  { input: "a 1,\n2\n3\n", expected: "a(1,2);3" },
  { input: "  a 1,\n  2\n  3\n", expected: "a(1,2);3" },

  // @-property access
  { input: '@hello', expected: 'this.hello' },
  { input: '@hello = 1', expected: 'this.hello = 1' },
  { input: '@hello()', expected: 'this.hello()' },
  { input: '@hello(+@bye)', expected: 'this.hello(+this.bye)' },

  // If statements / expressions
  { input: 'if x\n  hello()', expected: 'if (x) { hello() }' },
  { input: 'unless x\n  hello()', expected: 'unless (x) { hello() }' },
  { input: 'if x\n  hello()\n  what = "world"', expected: 'if (x) { hello();what = "world" }' },
  { input: 'if x\n  hello()\n  what = "world"\nok()', expected: 'if (x) { hello();what = "world" };ok()' },

  { input: 'if x then hello()', expected: 'if (x) { hello() }' },
  { input: 'unless x then hello()', expected: 'unless (x) { hello() }' },
  { input: 'if friday then jack else jill', expected: 'if (friday) { jack } else { jill }' },
  { input: 'data = if friday then jack else jill', expected: 'data = if (friday) { jack } else { jill }' },
  { input: 'if friday then sue else joy else huh', error: /Unexpected 'else'/ },

  { input: 'if x then', error: /Empty block in an 'if'/ },
  { input: 'if x then\n', error: /Unexpected newline after 'then'/ },

  { input: 'if x\nhello()', error: /Empty block in an 'if'/ },
  { input: 'unless x\nhello()', error: /Empty block in an 'unless'/ },

  // Loops
  { input: 'loop x()', expected: 'loop { x() }' },
  { input: 'loop\n  x()', expected: 'loop { x() }' },
  { input: 'loop\n  x()\n  y()', expected: 'loop { x();y() }' },
  { input: 'loop\nx()', error: /Empty block in a 'loop' expression/ },

  { input: 'until x > 2 then x = y()', expected: 'until (x > 2) { x = y() }' },

  { input: `for x in arr then x()`, expected: 'for x in arr { x() }' },
  { input: `for x in arr\n  x()`, expected: 'for x in arr { x() }' },
  { input: `for x in arr\nx()`, error: /Empty block in a 'for' expression/ },

  { input: `for elem, i in arr\n  elem(i)`, expected: 'for elem, i in arr { elem(i) }' },
  { input: `for key, val of obj\n  val(key)`, expected: 'for key, val of obj { val(key) }' },

  { input: 'for _, v of obj then v() if v', expected: 'for _, v of obj { v() if v }' },
  { input: 'for _, v of obj\n if v\n  v()', expected: 'for _, v of obj { if (v) { v() } }' },

  { input: 'numbers = loop x = z', expected: 'numbers = loop { x = z }' },
  { input: 'numbers = loop\n  x = z', expected: 'numbers = loop { x = z }' },

  { input: 'numbers = until z then x(z)', expected: 'numbers = until (z) { x(z) }' },

  { input: 'x for x in arr', expected: 'x for x in arr' },
  { input: 'numbers = (2*x for x in arr)', expected: 'numbers = (2 * x for x in arr)' },
  { input: 'foo x for x in arr', expected: 'foo(x) for x in arr' },
  { input: 'foo 2*x for x in arr', expected: 'foo(2 * x) for x in arr' },
  // ForExpression2 can't be greedy in imp fcalls, we want `foo(v) for k ...`
  // instead of `foo(v for k ...)`
  { input: 'foo v for k,v of obj', expected: 'foo(v) for k, v of obj' },

  // Nested for loop expressions
  { input: 'x for x in xs for xs in list', expected: 'x for x in xs for xs in list' },
  { input: 'ret = (x for x in xs for xs in list)', expected: 'ret = (x for x in xs for xs in list)' },

  { input: 'for 2*x,y in arr then x', error: /Expected left-hand value after 'for'/ },
  // TODO: Bad error message here: "Expected 'in' or 'of' after iterator, got '("
  { input: 'for x,y() in arr then x', error: true },

  { input: 'foo(x for x in arr)', expected: 'foo(x for x in arr)' },

  // One line can hold multiple statements / expressions separated by ';', the
  // semicolon-separated expressions are not only limited to one-line blocks.
  // Inputs below should be functionally identical.
  { input: 'foo = -> m = 10; m |= 2', expected: 'foo = () -> {m = 10;m |= 2}' },
  { input: 'foo = ->\n  m = 10\n  m |= 2', expected: 'foo = () -> {m = 10;m |= 2}' },
  { input: 'foo = ->\n  m = 10; m |= 2', expected: 'foo = () -> {m = 10;m |= 2}' },
  { input: 'foo = ->\n  m = 10;m |= 2', expected: 'foo = () -> {m = 10;m |= 2}' },
  { input: 'foo = ->\n  m = 10 ; m |= 2', expected: 'foo = () -> {m = 10;m |= 2}' },

  // Theres a number of weird semicolon combinations that are also legal in
  // coffeescript.
  { input: 'foo = ->\n a();b();', expected: 'foo = () -> {a();b()}' },
  { input: 'foo = ->\n a();;;b()', expected: 'foo = () -> {a();b()}' },
  { input: 'foo = ->\n a();;;b();;', expected: 'foo = () -> {a();b()}' },

  // Some semicolons are not legal though
  { input: 'foo = ->\n ;a()', error: true },
]

if (runAll(tests)) {
  console.log("SUCCESS")
} else {
  console.error("FAIL")
  process.exit(1)
}
