import {Token} from './scanner'
import * as nodes from './nodes'

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

  private parseBinaryExpression(): nodes.BinaryExpression | undefined {
    const pos = this.pos // stash pos if we have to roll back
    const getSide = () => this.parseNumber() || this.parseIdentifier()
    const left : nodes.Expression | undefined = getSide()
    if (!left) {
      return undefined
    }
    const op = this.getOperator()
    if (!op) {
      this.pos = pos
      return undefined
    }
    const right : nodes.Expression | undefined = this.parseBinaryExpression() || getSide()
    if (!right) {
      this.pos = pos
      return undefined
    }
    return new nodes.BinaryExpression(left, op, right)
  }

  private parseBlock() {
    return this.parseBinaryExpression()
  }

  public parse() {
    return this.parseBlock()
  }
}
