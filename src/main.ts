import {Scanner} from './scanner'
import {Parser} from './parser'
import * as util from 'util'

// const contents = `
// (1 + 2) * ((3 + 1) / 4)

// foo = ->
//   return 1
// `

const contents = `0 * 1 + 2 * 3 == (3 + 3)`
// const contents = `(1  + 2) * 3 * 4`
// const contents = `1 + 2 * 3`

const scanner = new Scanner()
scanner.reset(contents)
const tokens = scanner.scan()
console.log(tokens)

const parser = new Parser()
parser.reset(tokens)
const nodes = parser.parse()

console.log(util.inspect(nodes, false, null))

console.log(nodes?.emit())

console.log('evalMath:',nodes?.debugEvalJS())
console.log('eval:',eval(contents))
