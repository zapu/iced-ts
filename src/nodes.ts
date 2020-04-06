import {Token} from './scanner'

export abstract class Node {
  // trivia: Token[] = []
  // tokens: Token[] = []
  abstract emit(): string
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

export class Equality extends Expression {
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

export abstract class Operation extends Expression {

}

export class BinaryOperation extends Operation {
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
}

// export class Block extends Node {
//   expressions: Expression[] = []
// }
