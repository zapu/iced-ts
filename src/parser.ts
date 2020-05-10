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
  skipNewline: number
  inFCall: boolean
  inFCallImplicitArgs: number // trying to descend into function call without parentheses
}

function isUnary(token: Token): boolean {
  if (['UNARY', 'UNARY_MATH'].includes(token.type)) {
    return true
  }
  else if (token.type === 'OPERATOR' && ['+', '-'].includes(token.val)) {
    return true
  }
  return false
}

export class Parser {
  tokens: Token[] = []
  state: ParserState = {} as ParserState

  public reset(tokens: Token[]) {
    this.tokens = tokens
    this.state = {
      pos: 0,
      skipNewline: 0,
      inFCall: false,
      inFCallImplicitArgs: 0,
    }
  }

  private cloneState(): ParserState {
    return { ...this.state }
  }

  private peekWhitespace(): boolean {
    return ['WHITESPACE', 'NEWLINE'].includes(this.tokens[this.state.pos]?.type)
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

  private parseFunctionCall(): nodes.FunctionCall | undefined {
    if (this.state.inFCall) {
      return undefined
    }
    const state = this.cloneState()
    // Do not recurse on function call rule, we handle chained calls through a
    // loop in the rule itself.
    this.state.inFCall = true
    const target = this.parsePrimaryExpr()
    if (!target) {
      this.state = state
      return undefined
    }
    this.state.inFCall = false

    const nextToken = this.peekToken()
    if (nextToken?.type === '(') {
      this.takeToken()
      this.state.skipNewline++
      const args : nodes.Expression[] = []
      const firstArg = this.parseExpression()
      if (firstArg) {
        args.push(firstArg)
        while(this.peekToken()?.type === ',') {
          this.takeToken()
          const arg = this.parseExpression()
          if(!arg) {
            throw new Error("Expected an expression after ',' in function call")
          }
          args.push(arg)
        }
      }
      if (this.takeToken()?.type !== ')') {
        throw new Error('Expected ) in function call')
      }
      if (--this.state.skipNewline < 0) {
        throw new Error("internal: skipNewline mismatch")
      }
      return new nodes.FunctionCall(target, args)
    } else {
      // Implicit function call without parentheses.
      if(!this.peekWhitespace()) {
        // Requires a whitespace before first argument, so something like 'a+b'
        // is not parsed as 'a(+b)'.
        this.state = state
        return undefined
      }
      this.state.inFCallImplicitArgs++
      const firstArg = this.parseExpression()
      if(!firstArg) {
        this.state = state
        return undefined
      }
      const args = [firstArg]
      while(this.peekToken()?.type === ',') {
        // this.state.skipNewline++
        this.takeToken()
        const arg = this.parseExpression()
        if(!arg) {
          throw new Error("Expected an expression after ',' in function call")
        }
        args.push(arg)
        // this.state.skipNewline--
      }
      this.state.inFCallImplicitArgs--
      return new nodes.FunctionCall(target, args)
    }
  }

  private parseBinaryExpr(): nodes.Expression | undefined {
    let left = this.parseUnaryExpr()
    if(!left) {
      return undefined
    }
    while(this.peekToken()?.type === 'OPERATOR') {
      const opToken = this.takeToken()
      const right = this.parseUnaryExpr()
      if (!right) {
        throw new Error(`parse error after ${opToken.val}`)
      }
      if (left instanceof nodes.BinaryExpression) {
        if ((operatorPriority[opToken.val] ?? 0) > (operatorPriority[left.operator.val] ?? 0)) {
          left.right = new nodes.BinaryExpression(left.right, opToken, right)
          continue
        }
      }
      left = new nodes.BinaryExpression(left, opToken, right)
    }
    return left
  }

  private parseUnaryExpr(): nodes.Expression | undefined {
    const operator = this.peekToken()
    if(operator && isUnary(operator)) {
      this.takeToken()
      if (this.state.inFCallImplicitArgs > 0 && this.peekWhitespace()) {
        // In expression like 'a - b', do not consider '- b' to be an unary
        // expression, because then we would end up parsing it as 'a(-b)'.
        //
        // However', 'a -b' should actually be parsed as 'a(-b)'.
        return undefined
      }
      const expr = this.parsePrimaryExpr()
      if(!expr) {
        throw new Error(`Expected expression after unary operator '${operator.val}'`)
      }
      return new nodes.UnaryExpression(operator, expr)
    }

    return this.parsePrimaryExpr()
  }

  private parsePrimaryExpr(): nodes.Expression | undefined {
    // Primary expressions
    const simple = this.parseFunctionCall() ||
      this.parseNumber() ||
      this.parseIdentifier()
    if(simple) {
      return simple
    }

    return this.parseParentesiszedExpr()
  }

  private parseParentesiszedExpr(): nodes.Expression | undefined {
    if (this.peekToken()?.type !== '(') {
      return undefined
    }
    const state = this.cloneState()
    this.takeToken()
    // Found parentesiszed expression, start skipping newline.
    this.state.skipNewline++
    const expr = this.parseExpression()
    if (!expr) {
      throw new Error("Expected expression after (")
    }
    if (this.takeToken()?.type !== ')') {
      if (this.state.inFCall) {
        // We might have gotten here because we are parsing something like:
        //   `(func_foo 1, 2, 3)`
        //
        // Which leads us through the following path:
        // - parseExpression
        //  - parseBinaryExpr
        //   - parsePrimaryExpr
        //    - parseFunctionCall
        //     - parsePrimaryExpr (looking for target, inFCall is set)
        //      - (found parentesiszed expression), parseExpression
        //       - ... got `func_foo`
        //      - *WE ARE HERE* didn't get ')' after the expression
        //
        // So we have to rewind back and *start* with the parentesiszed and
        // find the function call inside, instead of starting with a function
        // call and trying to match parentesiszed expr as target.
        this.state = state
        return undefined
      }
      throw new Error("Expected ) after expression")
    }
    if (--this.state.skipNewline < 0) {
      throw new Error("internal: skipNewline mismatch")
    }
    return new nodes.Parens(expr)
  }

  private parseExpression(noBinary?: boolean): nodes.Node | undefined {
    return this.parseBinaryExpr()
  }

  private parseBlock() {
    return this.parseExpression()
  }

  public parse() {
    return this.parseBlock()
  }
}
