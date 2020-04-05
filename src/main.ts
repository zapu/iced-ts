import {Scanner} from './scanner'
import {Parser} from './parser'
import * as util from 'util'

const contents = `(1 + 2) * ((3 + 1) / 4)`

const scanner = new Scanner()
scanner.reset(contents)
const tokens = scanner.scan()
console.log(tokens)

const parser = new Parser()
parser.reset(tokens)
const nodes = parser.parse()

console.log(util.inspect(nodes, false, null))

console.log(nodes?.emit())
