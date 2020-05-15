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

export abstract class Expression extends Node {
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
  value: Expression

  constructor(target: Expression, value: Expression) {
    super()
    this.target = target
    this.value = value
  }

  emit(): string {
    return `${this.target.emit()} = ( ${this.value.emit()} )`
  }
  debugEvalJS() {
    throw new Error("Method not implemented.")
  }
  debugEmitCommon(): string {
    return `${this.target.debugEmitCommon()} = ${this.value.debugEmitCommon()}`
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

export class UnaryExpression extends Expression {
  operator: Token
  expression: Expression

  constructor(operator: Token, expression: Expression) {
    super()
    this.operator = operator
    this.expression = expression
  }

  emit(): string {
    return `${this.operator.val} ${this.expression.emit()}`
  }

  debugEvalJS(): number {
    switch (this.operator.val) {
      case '+':
        return this.expression.debugEvalJS()
      case '-':
        return -this.expression.debugEvalJS()
      default:
        throw new Error(`Invalid evalMath on ${this.emit()}`)
    }
  }

  debugEmitCommon() {
    return `${this.operator.val}${this.expression.debugEmitCommon()}`
  }
}

export class Block extends Node {
  expressions: Expression[] = []

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
