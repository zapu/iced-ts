import {Token} from './scanner'
import * as nodes from './nodes'

const operatorPriority : {[k: string]: number}= {
  '+': 50,
  '-': 50,
  '*': 100,
  '/': 100,
}

export class Parser {
  tokens: Token[] = []
  pos: number = 0

  public reset(tokens: Token[]) {
    this.tokens = tokens
    this.pos = 0
  }

  private peekToken(ahead: number = 0): Token | null {
    return this.tokens[this.pos + ahead] ?? null
  }

  private takeToken(): Token {
    if (this.pos >= this.tokens.length) {
      throw new Error("ran out of tokens in takeToken")
    }
    return this.tokens[this.pos++]
  }

  private parseNumber() {
    const token = this.peekToken()
    if (token?.type === 'NUMBER') {
      this.takeToken()
      return new nodes.Number(token.val)
    }
  }

  private parseIdentifier() {
    const token = this.peekToken()
    if (token?.type === 'IDENTIFIER') {
      this.takeToken()
      return new nodes.Identifier(token.val)
    }
  }

  private getOperator() {
    const token = this.peekToken()
    if (token?.type === 'OPERATOR') {
      this.takeToken()
      return token
    }
  }

  private parseExpression(noBinary: boolean = false): nodes.Expression | undefined {
    const token = this.peekToken()
    if (token?.type === '(') {
      this.takeToken()
      const pos = this.pos
      const expr = this.parseBinaryExpression() || this.parseExpression()
      if(!expr) {
        this.pos = pos
        return undefined
      }
      if (this.takeToken().type !== ')') {
        throw new Error(`Expected ) ${this.pos}`)
      }
      expr.parenthesized = true
      return expr
    }

    return (!noBinary && this.parseBinaryExpression()) ||
      this.parseNumber() ||
      this.parseIdentifier()
  }

  private parseBinaryExpression(): nodes.BinaryExpression | undefined {
    const pos = this.pos // stash pos if we have to roll back
    const left : nodes.Expression | undefined = this.parseExpression(true)
    if (!left) {
      this.pos = pos
      return undefined
    }
    const op = this.getOperator()
    if (!op) {
      this.pos = pos
      return undefined
    }
    const right : nodes.Expression | undefined = this.parseExpression()
    if (!right) {
      this.pos = pos
      return undefined
    }

    // We are building right-slanted tree here, our left side will always be
    // an Expression, but right side may be a BinaryExpression.
    const pri = operatorPriority[op.val] ?? 0
    if (right instanceof nodes.BinaryExpression && !right.parenthesized) {
      const rightPri = operatorPriority[right.operator.val] ?? 0
      if (pri > rightPri) {
        // Rotate tree if operator on the right side has lower priority.
        // E.g. we are * but we get + on the right side.
        const newRight = right.right
        const newLeft = new nodes.BinaryExpression(left, op, right.left)
        return new nodes.BinaryExpression(newLeft, right.operator, newRight)
      }
    }

    return new nodes.BinaryExpression(left, op, right)
  }

  private parseBlock() {
    return this.parseBinaryExpression() || this.parseExpression()
  }

  public parse() {
    return this.parseBlock()
  }
}
