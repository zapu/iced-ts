import { Scanner } from '../scanner'
import { Parser } from '../parser'
import * as util from 'util'

interface TestCase {
  input: string
  expected: string | undefined
}

function runAll(tests: TestCase[]) {
  let success = true
  for (const test of tests) {
    try {
      // TODO: Potential optimization, can create Scanner and Parser once and
      // only call `reset` on them in each test.
      const scanner = new Scanner()
      scanner.reset(test.input)
      const tokens = scanner.scan()

      const parser = new Parser()
      parser.reset(tokens)
      const nodes = parser.parse()

      const commonEmit = nodes?.debugEmitCommon()

      const inputCon = test.input.replace('\n', '\\n')

      if (test.expected !== commonEmit) {
        console.error(`[x] Failed for input: "${inputCon}": expected '${test.expected}' got '${commonEmit}'`)
        success = false
      } else {
        console.log(`[+] "${inputCon}" -> '${commonEmit}'`)
      }

    } catch (err) {
      console.error(`[x] Failed for input: "${test.input}": expected '${test.expected}' got exception: ${err.message}`)
      console.error(err)
      success = false
    }
  }
  return success
}

const tests: TestCase[] = [
  // Math
  { input: '1 + 2 * 3', expected: '1 + 2 * 3' },
  { input: '(1 + 2) * 3', expected: '(1 + 2) * 3' },
  { input: '1 * 2 + 3', expected: '1 * 2 + 3' },

  // Implicit function calls, without parentheses
  // TODO: iced2/3 compilers will parse differently when function call
  // target is not an identifier, so these tests will have to be redone,
  // because '1 +2' should actually parse as '1 + 2' instead of '1(+2)'.
  { input: '1 + 2', expected: '1 + 2' }, // not a function call
  { input: '1 +2', expected: '1(+2)' }, // but this one is a function call
  { input: '1 -2', expected: '1(-2)' },
  { input: '1 2', expected: '1(2)' },
  { input: 'foo +2, 3', expected: 'foo(+2,3)' },

  // Nested implicit function calls
  { input: 'foo +2, b 3', expected: 'foo(+2,b(3))' },
  { input: 'foo +2, b +3', expected: 'foo(+2,b(+3))' },
  { input: 'foo +2, b +3 | 0', expected: 'foo(+2,b(+3 | 0))' },
  { input: 'foo a b c', expected: 'foo(a(b(c)))' },

  // Other function calls
  { input: 'foo(2)', expected: 'foo(2)' },
  { input: 'foo(2, 3, 4)', expected: 'foo(2,3,4)' },

  { input: '(foo 2, 3, 4)', expected: '(foo(2,3,4))' },
  { input: '(foo)(2)', expected: '(foo)(2)' },
  { input: '(foo) 2', expected: '(foo)(2)' },
  { input: '(foo) (2)', expected: '(foo)(2)' },
  { input: '(foo) (a b)', expected: '(foo)(a(b))' },
  { input: '(foo) (a, b)', expected: '(foo)(a,b)' },
]

if (runAll(tests)) {
  console.log("SUCCESS")
} else {
  console.error("FAIL")
  process.exit(1)
}
