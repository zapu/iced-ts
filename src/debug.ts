import { Scanner } from './scanner'
import { Parser } from './parser'
import * as util from 'util'

async function main() {
//   let contents = `
// foo
//   hello : world
//   'hello': 50221
// `
  let contents = `++a?`

  console.log('input:')
  console.log(contents.replace(/ /g, '·').replace(/\n/g, '⏎\n'))

  const scanner = new Scanner()
  scanner.reset(contents)
  const tokens = scanner.scan()
  console.log('tokens:')
  console.log(tokens)

  const parser = new Parser()
  parser.reset(tokens)
  const nodes = parser.parse()

  console.log('nodes (inspect):')
  console.log(util.inspect(nodes, false, null))

  console.log('common:', nodes?.debugEmitCommon())
  console.log('emit:')
  console.log(nodes?.emit())

  console.log('evalMath:', nodes?.debugEvalJS())
  console.log('eval:', eval(contents))
}

main().then(() => {
  process.exit(0)
}).catch((reason) => {
  console.error('error:', reason)
  process.exit(1)
})
