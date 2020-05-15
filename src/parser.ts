import { Token, isTrivia } from './scanner'
import * as nodes from './nodes'

const operatorPriority: { [k: string]: number } = {
  '+': 50,
  '-': 50,
  '*': 100,
  '/': 100,
}

interface ParserState {
  pos: number
  skipNewline: number
  inFCall: 0
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
      inFCall: 0,
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
    for (let i = this.state.pos; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if (this.state.skipNewline && token.type === 'NEWLINE') {
        continue
      }
      if (!isTrivia(token.type)) {
        return token
      }
    }
  }

  private takeToken(): Token {
    while (this.state.pos < this.tokens.length) {
      const token = this.tokens[this.state.pos]
      this.state.pos++
      if (this.state.skipNewline && token.type === 'NEWLINE') {
        continue
      }
      if (!isTrivia(token.type)) {
        return token
      }
    }
    throw new Error("Ran out of tokens")
  }

  private returnToken(): void {
    this.state.pos--
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
    const state = this.cloneState()
    // Do not recurse on function call rule, we handle chained calls through a
    // loop in the rule itself.
    this.state.inFCall++
    const target = this.parseIdentifier() ?? this.parseParentesiszedExpr()
    if (!target) {
      this.state = state
      return undefined
    }
    this.state.inFCall--

    let ret: nodes.FunctionCall | undefined
    const chainFCall = (args: nodes.Expression[]) => {
      if (!ret) {
        ret = new nodes.FunctionCall(target, args)
      } else {
        ret = new nodes.FunctionCall(ret, args)
      }
    }

    while (true) {
      if (this.peekWhitespace()) {
        // If there is a whitespace before argument list, it has to be
        // "implicit" function call without parentheses.
        this.state.inFCallImplicitArgs++
        const firstArg = this.parseExpression()
        if (!firstArg) {
          this.state.inFCallImplicitArgs--
          break
        }
        const args = [firstArg]
        while (this.peekToken()?.type === ',') {
          // this.state.skipNewline++
          this.takeToken()
          const arg = this.parseExpression()
          if (!arg) {
            throw new Error("Expected an expression after ',' in function call")
          }
          args.push(arg)
          // this.state.skipNewline--
        }
        this.state.inFCallImplicitArgs--
        chainFCall(args)
      } else if (this.peekToken()?.type === '(') {
        this.takeToken()
        this.state.skipNewline++
        const args: nodes.Expression[] = []
        const firstArg = this.parseExpression()
        if (firstArg) {
          args.push(firstArg)
          while (this.peekToken()?.type === ',') {
            this.takeToken()
            const arg = this.parseExpression()
            if (!arg) {
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
        chainFCall(args)
      } else {
        break
      }
    }

    if (!ret) {
      // We didn't parse anything - restore state and return undefined.
      this.state = state
      return undefined
    }
    return ret
  }

  private parseBinaryExpr(): nodes.Expression | undefined {
    let left = this.parseUnaryExpr()
    if (!left) {
      return undefined
    }
    while (this.peekToken()?.type === 'OPERATOR') {
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

  private parseAssign(): nodes.Assign | undefined {
    const state = this.cloneState()
    const target = this.parseIdentifier()
    if (!target) {
      return undefined
    }
    if (this.peekToken()?.type !== '=') {
      this.state = state
      return undefined
    }
    const operator = this.takeToken()

    const value = this.parseExpression()
    if (!value) {
      throw new Error("Unexpected expression after assignment operator")
    }

    return new nodes.Assign(target, value)
  }

  private parseFunctionParam(): nodes.FunctionParam | undefined {
    const param = this.parseIdentifier() // TODO: Or object literal, or array literal
    if (!param) {
      return undefined
    }

    const state = this.cloneState()
    let defaultValue
    if (this.peekToken()?.type === '=') {
      this.takeToken()
      defaultValue = this.parseExpression()
      if (!defaultValue) {
        this.state = state
        return undefined
      }
    }

    return { param, defaultValue }
  }

  private parseFunction(): nodes.Function | undefined {
    const state = this.cloneState()

    const argList: nodes.FunctionParam[] = []
    if (this.peekToken()?.type === '(') {
      this.takeToken()

      if (this.peekToken()?.type !== ')') {
        const firstArg = this.parseFunctionParam()
        if (!firstArg) {
          this.state = state
          return undefined
        }

        argList.push(firstArg)

        while (true) {
          if (this.peekToken()?.type !== ',') {
            break
          }
          this.takeToken()

          const param = this.parseFunctionParam()
          if (!param) {
            this.state = state
            return undefined
          }
          argList.push(param)
        }

        if (this.peekToken()?.type !== ')') {
          this.state = state
          return undefined
        }

        this.takeToken()
      } else {
        this.takeToken()
      }
    } else {
      if (this.state.inFCallImplicitArgs) {
        this.state = state
        return undefined
      }
    }

    if (this.peekToken()?.type !== 'FUNC') {
      this.state = state
      return undefined
    }

    const funcToken = this.takeToken()
    const bindThis = funcToken.val === '=>'

    let body = this.parseBlock()
    if (!body) {
      body = new nodes.Block()
    }

    return new nodes.Function(argList, body, bindThis)
  }

  private parseUnaryExpr(): nodes.Expression | undefined {
    const operator = this.peekToken()
    if (operator && isUnary(operator)) {
      this.takeToken()
      if (this.state.inFCallImplicitArgs > 0 && this.peekWhitespace()) {
        // In expression like 'a - b', do not consider '- b' to be an unary
        // expression, because then we would end up parsing it as 'a(-b)'.
        //
        // However', 'a -b' should actually be parsed as 'a(-b)'.
        this.returnToken()
        return undefined
      }
      const expr = this.parsePrimaryExpr()
      if (!expr) {
        throw new Error(`Expected expression after unary operator '${operator.val}'`)
      }
      return new nodes.UnaryExpression(operator, expr)
    }

    return this.parsePrimaryExpr()
  }

  private parsePrimaryExpr(): nodes.Expression | undefined {
    // Primary expressions
    const simple = this.parseFunctionCall() ??
      this.parseAssign() ??
      this.parseNumber() ??
      this.parseIdentifier() ??
      this.parseFunction()

    if (simple) {
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
      this.state = state
      return undefined
    }
    const next = this.peekToken()
    if (next?.type === ')') {
      this.takeToken()
    } else {
      if (this.state.inFCall > 0) {
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
      throw new Error(`Unexpected '${next?.val}' after expression, expected ')'`)
    }
    if (--this.state.skipNewline < 0) {
      throw new Error("internal: skipNewline mismatch")
    }
    return new nodes.Parens(expr)
  }

  private parseExpression(): nodes.Expression | undefined {
    return this.parseBinaryExpr()
  }

  private parseBlock() {
    const block = new nodes.Block()
    // Skip initial newlines
    while (this.peekToken()?.type === 'NEWLINE') {
      this.takeToken()
    }

    for (; ;) {
      const expr = this.parseExpression()
      if (!expr) {
        break
      }
      block.expressions.push(expr)

      const separator = this.peekToken()
      if (!separator) {
        break
      } else if (separator.type !== 'NEWLINE') {
        throw new Error(`Unexpected after expression: ${separator.val}`);
      } else {
        this.takeToken()
      }
    }
    return block
  }

  public parse() {
    return this.parseBlock()
  }
}
