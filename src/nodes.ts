import { Token } from './scanner'

export abstract class Node {
  // trivia: Token[] = []
  // tokens: Token[] = []
  abstract emit(): string
  abstract debugEvalJS(): any

  abstract debugEmitCommon(): string
}

export class Parens extends Node {
  contents: Node

  constructor(contents: Node) {
    super()
    this.contents = contents
  }

  emit() {
    return `( ${this.contents.emit()} )`
  }

  debugEvalJS() {
    return this.contents.debugEvalJS()
  }

  debugEmitCommon() {
    return `(${this.contents.debugEmitCommon()})`
  }
}

export class ReturnStatement extends Node {
  expr: Expression | undefined

  constructor(expr: Expression | undefined) {
    super()
    this.expr = expr
  }

  emit(): string {
    if (this.expr) {
      return `return ${this.expr.emit()}`
    } else {
      return 'return'
    }
  }

  debugEvalJS() {
    throw new Error("Method not implemented.")
  }

  debugEmitCommon(): string {
    if (this.expr) {
      return `return ${this.expr.debugEmitCommon()}`
    } else {
      return 'return'
    }
  }
}

export abstract class Expression extends Node {
}

export class BuiltinPrimaryExpression extends Expression {
  token: Token
  constructor(token: Token) {
    super()
    this.token = token
  }

  emit(): string {
    return this.token.val
  }

  debugEvalJS() {
    switch(this.token.val) {
      case 'true':
        return true
      case 'false':
        return false
      case 'undefined':
        return undefined
      case 'null':
        return null
      default:
        throw new Error('unknown built-in primary expression')
    }
  }

  debugEmitCommon() {
    return this.token.val
  }
}

export class ThisExpression extends Expression {
  token: Token
  constructor(token: Token) {
    super()
    this.token = token
  }

  emit(): string {
    return 'this'
  }

  debugEvalJS() {
    throw new Error('cannot debugEvalJS `this`')
  }

  debugEmitCommon() {
    return 'this'
  }
}

export class Number extends Expression {
  content: string
  constructor(content: string) {
    super()
    this.content = content
  }

  emit(): string {
    return this.content
  }

  debugEvalJS() {
    return parseInt(this.content)
  }

  debugEmitCommon() {
    return this.content
  }
}

export class StringLiteral extends Expression {
  content: string
  constructor(content: string) {
    super()
    this.content = content
  }

  emit(): string {
    return this.content
  }

  debugEvalJS() {
    return parseInt(this.content)
  }

  debugEmitCommon() {
    return this.content
  }
}

export class Identifier extends Expression {
  content: string
  constructor(content: string) {
    super()
    this.content = content
  }

  emit(): string {
    return this.content
  }

  debugEvalJS(): number {
    throw new Error(`Invalid evalMath on ${this.content}`)
  }

  debugEmitCommon() {
    return this.content
  }
}

export class BinaryExpression extends Expression {
  left: Expression
  operator: Token
  right: Expression

  constructor(left: Expression, operator: Token, right: Expression) {
    super()
    this.left = left
    this.operator = operator
    this.right = right
  }

  emit(): string {
    return `( ${this.left.emit()} ${this.operator.val} ${this.right.emit()} )`
  }

  debugEvalJS(): any {
    switch (this.operator.val) {
      case '+':
        return this.left.debugEvalJS() + this.right.debugEvalJS()
      case '-':
        return this.left.debugEvalJS() - this.right.debugEvalJS()
      case '*':
        return this.left.debugEvalJS() * this.right.debugEvalJS()
      case '/':
        return this.left.debugEvalJS() / this.right.debugEvalJS()
      case '==':
      case 'is':
        return this.left.debugEvalJS() === this.right.debugEvalJS()
      case '!=':
      case 'isnt':
        return this.left.debugEvalJS() !== this.right.debugEvalJS()
      default:
        throw new Error(`Don't know how to evalJS with ${this.operator.val}`)
    }
  }

  debugEmitCommon() {
    return `${this.left.debugEmitCommon()} ${this.operator.val} ${this.right.debugEmitCommon()}`
  }
}

export abstract class Operation extends Expression {

}

export class Assign extends Expression {
  target: Expression
  operator: Token
  value: Expression

  constructor(target: Expression, operator: Token, value: Expression) {
    super()
    this.target = target
    this.operator = operator
    this.value = value
  }

  emit(): string {
    return `${this.target.emit()} ${this.operator.val} ( ${this.value.emit()} )`
  }

  debugEvalJS() {
    throw new Error("Method not implemented.")
  }

  debugEmitCommon(): string {
    return `${this.target.debugEmitCommon()} ${this.operator.val} ${this.value.debugEmitCommon()}`
  }
}

export interface PropertyValuePair {
  propertyId: Identifier | StringLiteral
  value: Expression
}

export class ObjectLiteral extends Node {
  properties: PropertyValuePair[] = []

  constructor() {
    super()
  }

  emit(): string {
    throw new Error("Method not implemented.")
  }

  debugEvalJS() {
    throw new Error("Method not implemented.")
  }

  debugEmitCommon(): string {
    const propList = this.properties.map(x => {
      return `${x.propertyId.debugEmitCommon()}: ${x.value.debugEmitCommon()}`
    }).join(', ')
    return `{${propList}}`
  }
}

export class ArrayLiteral extends Node {
  emit(): string {
    throw new Error("Method not implemented.")
  }
  debugEvalJS() {
    throw new Error("Method not implemented.")
  }
  debugEmitCommon(): string {
    throw new Error("Method not implemented.")
  }

}

export interface FunctionParam {
  param: Identifier
  defaultValue?: Expression
  splat: boolean
}

export class Function extends Expression {
  args: FunctionParam[]
  body: Block
  bindThis: boolean

  constructor(args: FunctionParam[], body: Block, bindThis: boolean) {
    super()
    this.args = args
    this.body = body
    this.bindThis = bindThis
  }

  emitParam(fp: FunctionParam) {
    let ret = fp.param.emit()
    if (fp.defaultValue) {
      ret += `=${fp.defaultValue.emit()}`
    }
    if (fp.splat) {
      ret += '...'
    }
    return ret
  }

  emit(): string {
    const argList = this.args.map((x) => this.emitParam(x))
    return `(${argList.join(',')}) ${this.bindThis ? '=>' : '->'} {\n${this.body.emit()} }`
  }

  debugEvalJS() {
    throw new Error("Method not implemented.")
  }

  emitParamCommon(fp: FunctionParam) {
    let ret = fp.param.debugEmitCommon()
    if (fp.defaultValue) {
      ret += `=${fp.defaultValue.debugEmitCommon()}`
    }
    if (fp.splat) {
      ret += '...'
    }
    return ret
  }

  debugEmitCommon(): string {
    const argList = this.args.map((x) => this.emitParamCommon(x))
    return `(${argList.join(',')}) ${this.bindThis ? '=>' : '->'} {${this.body.debugEmitCommon()}}`
  }
}

export class FunctionCall extends Expression {
  target: Expression
  args: Expression[]

  constructor(target: Expression, args: Expression[]) {
    super()
    this.target = target
    this.args = args
  }

  emit(): string {
    return `${this.target.emit()}(${this.args.map(x => x.emit()).join(', ')})`
  }

  debugEvalJS(): number {
    throw new Error(`Invalid evalMath on ${this.emit()}`)
  }

  debugEmitCommon() {
    return `${this.target.debugEmitCommon()}(${this.args.map(x => x.debugEmitCommon()).join(',')})`
  }
}

export abstract class UnaryExpression extends Expression {
  operator: Token
  expression: Expression

  constructor(operator: Token, expression: Expression) {
    super()
    this.operator = operator
    this.expression = expression
  }

  emit(): string {
    return `${this.operator.val}${this.expression.emit()}`
  }

  debugEvalJS(): number {
    switch (this.operator.val) {
      case '+':
        return this.expression.debugEvalJS()
      case '-':
        return -this.expression.debugEvalJS()
      case '++':
      case '--':
        throw new Error(`Eval math not implemented for ${this.emit()}`)
      default:
        throw new Error(`Invalid evalMath on ${this.emit()}`)
    }
  }

  debugEmitCommon() {
    return `${this.operator.val}${this.expression.debugEmitCommon()}`
  }
}

export class PrefixUnaryExpression extends UnaryExpression {}

export class PostfixUnaryExpression extends UnaryExpression {
  emit(): string {
    return `${this.expression.emit()}${this.operator.val}`
  }

  debugEvalJS(): number {
    switch (this.operator.val) {
      case '++':
      case '--':
        throw new Error(`Eval math not implemented for ${this.emit()}`)
      default:
        throw new Error(`Invalid evalMath on ${this.emit()}`)
    }
  }

  debugEmitCommon() {
    return `${this.expression.debugEmitCommon()}${this.operator.val}`
  }
}

export class PropertyAccess extends Expression {
  target: Expression
  access: Expression

  constructor(target: Expression, access: Expression) {
    super()
    this.target = target
    this.access = access
  }

  emit(): string {
    return `${this.target.emit()}.${this.access.emit()}`
  }

  debugEvalJS() {
    throw new Error("Method not implemented.")
  }

  debugEmitCommon(): string {
    return `${this.target.debugEmitCommon()}.${this.access.debugEmitCommon()}`
  }
}

export class Block extends Node {
  expressions: Expression[] = []
  indent: number = 0

  emit(): string {
    return this.expressions
      .map(x => x.emit())
      .join('\n')
  }

  debugEvalJS(): number {
    if (this.expressions.length === 1) {
      return this.expressions[0].debugEvalJS()
    }
    throw new Error("Method not implemented.")
  }

  debugEmitCommon(): string {
    return this.expressions
      .map(x => x.debugEmitCommon())
      .join(';')
  }
}
