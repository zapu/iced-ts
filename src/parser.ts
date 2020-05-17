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
  inFCall: number
  inFCallImplicitArgs: number // trying to descend into function call without parentheses

  // Are we parsing a parenthesized expression right now? It changes some
  // behavior i.e. during block parsing - which can end with close-paren, like:
  // setTimeout (-> hello(); world()), 10
  inParens: number

  indentStack: number[]
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
      inParens: 0,

      indentStack: [],
    }
  }

  private cloneState(): ParserState {
    return { ...this.state }
  }

  private currentIndentLevel(): number {
    if(this.state.indentStack.length) {
      return this.state.indentStack[this.state.indentStack.length - 1]
    } else {
      throw new Error('BUG: currentIndentLevel but indentStack is empty')
    }
  }

  private peekWhitespace(): boolean {
    return ['WHITESPACE', 'NEWLINE'].includes(this.tokens[this.state.pos]?.type)
  }

  private findIndent(startPos: number): { indent: number, pos: number } {
    if (this.tokens[startPos]?.type !== 'NEWLINE') {
      throw new Error("BUG: cannot do peekIndent() while not at NEWLINE")
    }

    let indent = 0
    let pos = startPos + 1
    for (; pos < this.tokens.length; pos++) {
      const token = this.tokens[pos]
      if(token.type === 'WHITESPACE') {
        indent += token.val.length
      } else if(token.type === 'COMMENT') {
        // Ignore comments here
      } else if (token.type === 'NEWLINE') {
        // Reset current indent and keep looking on next line
        indent = 0
      } else {
        break
      }
    }
    return { indent, pos }
  }

  private findToken(peek: boolean, skipNewline: boolean): Token | undefined {
    for (let i = this.state.pos; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if(skipNewline && token.type === 'NEWLINE') {
        const { indent, pos } = this.findIndent(i)
        if(indent < this.currentIndentLevel()) {
          throw new Error('Unexpected outdent')
        }
        i = pos - 1
        continue
      }
      if(!isTrivia(token.type)) {
        if(!peek) {
          this.state.pos = i + 1
        }
        return token
      }
    }
  }

  private peekToken(): Token | undefined {
    return this.findToken(true /* peek */, this.state.skipNewline > 0)
  }

  private takeToken(): Token {
    const tok = this.findToken(false, this.state.skipNewline > 0)
    if(!tok) {
      throw new Error('Ran out of tokens')
    }
    return tok
  }

  private returnToken(): void {
    this.state.pos--
  }

  private advanceThroughNewlinesToToken(): void {
    this.findToken(false, true)
    this.returnToken()
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

  private parseStringLiteral() {
    const token = this.peekToken()
    if (token?.type === 'STRING') {
      this.takeToken()
      return new nodes.StringLiteral(token.val)
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
      this.state.skipNewline++
      const right = this.parseUnaryExpr()
      this.state.skipNewline--
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

    this.advanceThroughNewlinesToToken()

    const value = this.parseExpression()
    if (!value) {
      throw new Error("Expected an expression after assignment operator")
    }

    return new nodes.Assign(target, value)
  }

  private parseObjectLiteral(): nodes.ObjectLiteral | undefined {
    if (this.peekToken()?.type !== '{') {
      return undefined
    }

    // Advance past newlines
    while(this.peekToken()?.type === 'NEWLINE') {
      this.takeToken()
    }

    const state = this.cloneState()
    this.takeToken()

    const obj = new nodes.ObjectLiteral()

    for (; ;) {
      const id = this.parseIdentifier() ?? this.parseStringLiteral()
      if (!id) {
        throw new Error(`Expected string literal or identifier in object, found: ${this.peekToken()?.val}`)
      }

      const colon = this.takeToken()
      if (colon.type !== ':') {
        throw new Error(`Expected ':', got ${colon.val}`)
      }

      const expr = this.parseExpression()
      if (!expr) {
        throw new Error("Expected expression")
      }

      obj.properties.push({ propertyId: id, value: expr })

      this.state.skipNewline++
      const next = this.peekToken()


      if(next?.type === "}") {
        this.takeToken()
        this.state.skipNewline--
        break
      } else if(next?.type === ',') {
        this.takeToken()
        this.state.skipNewline--
        continue
      } else {
        this.state.skipNewline--
      }
    }


    return obj
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

      this.state.inParens++

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

      this.state.inParens--
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
      this.state.skipNewline++
      const expr = this.parsePrimaryExpr()
      this.state.skipNewline--
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
      this.parseStringLiteral() ??
      this.parseIdentifier() ??
      this.parseObjectLiteral() ??
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
    // And parsing coming from this point has to be aware that we are in the
    // middle of parentheses.
    this.state.inParens++
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
    this.state.skipNewline--
    this.state.inParens--
    return new nodes.Parens(expr)
  }

  private parseExpression(): nodes.Expression | undefined {
    return this.parseBinaryExpr()
  }

  private parseBlock() {
    const state = this.cloneState()
    const block = new nodes.Block()

    // The block can't start inline with previous block and continue on the
    // subsequent lines, like follows:
    //
    // foo = -> hello()
    //   world()
    //
    // This is invalid and would fail with "unexpected identation" on second
    // line.

    // Some block syntax that should work:
    //
    // foo (-> hello()), 10
    //
    // this.state.inParens helps with it, signifying that we can stop on
    // closing parenthesis without error.

    const lastIndent = this.state.indentStack[this.state.indentStack.length - 1] as number | undefined
    const rootBlock = lastIndent === undefined

    if (rootBlock || this.peekToken()?.type === 'NEWLINE') {
      // either a root block, or block starting on the next line (e.g. after
      // function def. token).
      let blockIndent: number | undefined = undefined;
      for (; ;) {
        const lineStartPos = this.state.pos

        let lineIndent = 0;
        while (this.state.pos < this.tokens.length) {
          const cur = this.tokens[this.state.pos]
          if (cur.type === 'WHITESPACE') {
            lineIndent += cur.val.length
          } else if (cur.type === 'NEWLINE') {
            // We got a newline while counting indents for current line, reset
            // indent counter and try again for the next line. Empty lines with
            // random indents are fine and do not interrupt block flow.
            lineIndent = 0;
          } else if (cur.type === 'COMMENT') {
            // Just skip over comments for now.
          } else {
            // We found something else than WHITESPACE, NEWLINE or trivia -
            // we know how indented it is and we can start parsing.
            break
          }

          this.state.pos++
        }

        if (this.state.pos === this.tokens.length) {
          // We ran out of tokens.
          return block
        }

        if (blockIndent === undefined) {
          blockIndent = lineIndent
          if (!rootBlock && lineIndent === lastIndent) {
            // empty block, we immediately indented back to previous block
            // indentation.
            this.state = state
            return undefined
          }

          this.state.indentStack = [...this.state.indentStack, blockIndent]
        } else {
          if (lineIndent < blockIndent) {
            // end of block
            this.state.pos = lineStartPos
            break
          }
        }

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
        }
      }

      if (!rootBlock) {
        // Restore indent stack
        this.state.indentStack = this.state.indentStack.slice(0, -1)
      }
    } else if (this.peekToken()) {
      // anything else (that's not a whitespace)
      loop: for (; ;) {
        const expr = this.parseExpression()
        if (!expr) {
          if (this.state.inParens) {
            return block
          }
          throw new Error(`Expected an expression`)
        }

        block.expressions.push(expr)
        switch (this.peekToken()?.type) {
          case 'NEWLINE': // end of line
          case undefined: // end of file
            break loop
          case ';':
            this.takeToken()
            continue
          case ')':
            if (this.state.inParens) {
              break loop
            } else {
              throw new Error(`Unexpected ${this.peekToken()?.val}`)
            }
            break
          default:
            throw new Error(`Unexpected ${this.peekToken()?.val}`)
        }
      }
    }

    return block
  }

  public parse() {
    return this.parseBlock()
  }
}
