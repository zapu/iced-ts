import {Token} from './scanner'

export abstract class Node {
  // trivia: Token[] = []
  // tokens: Token[] = []
}

export abstract class Expression extends Node {
  abstract emit(): string
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
}

export class Block extends Node {
  expressions: Expression[] = []
}
