import {Token, isTrivia} from './scanner'
import * as nodes from './nodes'

const operatorPriority : {[k: string]: number}= {
  '+': 50,
  '-': 50,
  '*': 100,
  '/': 100,
}

interface ParserState {
  pos: number
  skipNewline: boolean
}

export class Parser {
  tokens: Token[] = []
  state: ParserState = {} as ParserState

  public reset(tokens: Token[]) {
    this.tokens = tokens
    this.state = {
      pos: 0,
      skipNewline: false,
    }
  }

  private cloneState(): ParserState {
    return { ...this.state }
  }

  private peekToken(): Token | undefined {
    for(let i = this.state.pos; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if(this.state.skipNewline && token.type === 'NEWLINE') {
        continue
      }
      if(!isTrivia(token.type)) {
        return token
      }
    }
  }

  private takeToken(): Token {
    while(this.state.pos < this.tokens.length) {
      const token = this.tokens[this.state.pos]
      this.state.pos++
      if(this.state.skipNewline && token.type === 'NEWLINE') {
        continue
      }
      if(!isTrivia(token.type)) {
        return token
      }
    }
    throw new Error("Ran out of tokens")
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

  private parseOperator() {
    const token = this.peekToken()
    if (token?.type === 'OPERATOR') {
      this.takeToken()
      return token
    }
  }

  private parseParenthesizedExpression(): nodes.Expression | undefined {
    const token = this.peekToken()
    if (token?.type === '(') {
      this.takeToken()
      const expr = this.parseExpression()
      if (!expr) {
        throw new Error("Expected an expression after (")
      }
      if (this.takeToken().type !== ')') {
        throw new Error('Expected )')
      }
      expr.parenthesized = true
      return expr
    }
  }

  private parseFunctionCall(): nodes.FunctionCall | undefined {
    const state = this.cloneState()
    const target = this.parseExpression()
    if (!target) {
      this.state = state
      return undefined
    }
    if (this.takeToken()?.type !== '(') {
      this.state = state
      return undefined
    }
    this.state.skipNewline = true
    const argument = this.parseExpression()
    if (this.takeToken()?.type !== ')') {
      throw new Error('Expected ) in function call')
    }
    this.state.skipNewline = false
    return new nodes.FunctionCall(target, argument ? [argument] : [])
  }

  private parseExpression(noBinary?: boolean): nodes.Expression | undefined {
    return this.parseParenthesizedExpression() ||
      this.parseFunctionCall() ||
      (!noBinary && this.parseBinaryOperation()) ||
      this.parseNumber() ||
      this.parseIdentifier()
  }

  private parseBinaryOperation(): nodes.BinaryOperation | undefined {
    const state = this.cloneState()
    this.state.skipNewline = true
    const left : nodes.Expression | undefined = this.parseExpression(true)
    if (!left) {
      this.state = state
      return undefined
    }
    const op = this.parseOperator()
    if (!op) {
      this.state = state
      return undefined
    }
    const right : nodes.Expression | undefined = this.parseExpression()
    if (!right) {
      throw new Error(`Expected to find an expression after '${op.val}'`)
    }

    this.state.skipNewline = false

    // We are building right-slanted tree here, our left side will always be
    // an Expression, but right side may be a BinaryExpression.
    const pri = operatorPriority[op.val] ?? 0
    if (right instanceof nodes.BinaryOperation && !right.parenthesized) {
      const rightPri = operatorPriority[right.operator.val] ?? 0
      if (pri > rightPri) {
        // Rotate tree if operator on the right side has lower priority.
        // E.g. we are * but we get + on the right side.
        const newRight = right.right
        const newLeft = new nodes.BinaryOperation(left, op, right.left)
        return new nodes.BinaryOperation(newLeft, right.operator, newRight)
      }
    }

    return new nodes.BinaryOperation(left, op, right)
  }

  private parseBlock() {
    return this.parseExpression()
  }

  public parse() {
    return this.parseBlock()
  }
}
