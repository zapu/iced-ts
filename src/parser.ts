import { Token, isTrivia } from './scanner'
import * as nodes from './nodes'
import { start } from 'repl'
import { exception } from 'console'

const operatorPriority: { [k: string]: number } = {
  'if': 1,
  'unless': 1,

  'is': 10,
  'isnt': 10,
  '==': 10,
  '!=': 10,
  '>=': 10,
  '<=': 10,
  '>': 10,
  '<': 10,

  // TODO: Add priorities for stuff like `^` `|`
  '+': 50,
  '-': 50,
  '*': 100,
  '/': 100,
}

interface ParserState {
  pos: number
  inFCall: number

  // Are we parsing a parenthesized expression right now? It changes some
  // behavior i.e. during block parsing - which can end with close-paren, like:
  // setTimeout (-> hello(); world()), 10
  inParens: number

  // `moveToNextLine` by default will throw an error about "missing indentation"
  // if indent found in next line is smaller than `currentMinIndent`. But parsing
  // block special cases this (using `inBlock` arg) to find end of blocks.
  indentStack: number[]

  // Set to true when `moveToNextLine` hits end of token stream when looking
  // for a non-whitespace and non-newline token.
  eof: boolean
}

// Additional state that's passed to grammar rule functions when parsing an
// expression. Has to be passed starting from `parseExpression` through other
// rules all the way to terminal rules. Some rules will break propagation of
// some variables - like parenthesized expression.
interface ParseExpressionState {
  // When expression starts on a new line, e.g. from assignment or value in
  // object literal. Affects how object literals are parsed - when omitting
  // brackets, inline object literals have different parsing rules than object
  // literal starting on a new line, with optional indentation.
  exprIndent?: number

  // Are we trying to parse implicit function call argument? Behavior of some
  // of the parsing is going to change, e.g. we are never going to parse `x for
  // x ...` expresion in implicit function call, as well as we are going to
  // stop at binary 'IF' and 'UNLESS', to make parsing less greedy (so `x 1 if
  // cond` is `x(1) if cond`, not `x(1 if cond)`).
  implicitFcallArg?: boolean
}

function isUnary(token: Token): boolean {
  if (['UNARY', 'UNARY_MATH'].includes(token.type)) {
    return true
  }
  else if (token.type === 'OPERATOR' && ['+', '-', '++', '--'].includes(token.val)) {
    return true
  }
  return false
}

function isBinary(token: Token | undefined): boolean {
  return !!token && ((
    token.type === 'OPERATOR' &&
    ['+', '-', '*', '/', '|', '^', '&',
      'is', 'isnt', '==', '!=',
      '>=', '<=', '>', '<',
      '<<', '>>>', '>>'
    ].includes(token.val)) ||
    ['IF', 'UNLESS', 'IN', 'OF'].includes(token.type))
}

export class Parser {
  tokens: Token[] = []
  state: ParserState = {} as ParserState

  public reset(tokens: Token[]) {
    this.tokens = tokens
    this.state = {
      pos: 0,
      inFCall: 0,
      inParens: 0,

      indentStack: [],

      eof: false,
    }
  }

  private cloneState(): ParserState {
    return { ...this.state }
  }

  private currentIndentLevel(): number {
    if (this.state.indentStack.length) {
      return this.state.indentStack[this.state.indentStack.length - 1]
    } else {
      throw new Error('BUG: currentIndentLevel but indentStack is empty')
    }
  }

  private peekSpace(): boolean {
    return this.tokens[this.state.pos]?.type === 'WHITESPACE'
  }

  private peekNewline(): boolean {
    // peekToken() never skips over NEWLINEs, use it to check if there is a new
    // line, because there might be a stream of tokens like '[WHITESPACE] [NEWLINE]'.
    return this.peekToken()?.type === 'NEWLINE'
  }

  // moveToNewLine returns indent
  private moveToNextLine(inBlock?: boolean): number {
    let startPos = this.state.pos

    let indent = 0
    let pos = startPos
    if (!(inBlock && startPos === 0)) {
      if (this.takeToken().type !== 'NEWLINE') {
        throw new Error("BUG: cannot do moveToNextLine() while not at NEWLINE")
      }
      pos++ // skip over first newline
    }

    let foundToken = false
    for (; pos < this.tokens.length; pos++) {
      const token = this.tokens[pos]
      if (token.type === 'WHITESPACE') {
        indent += token.val.length
      } else if (token.type === 'COMMENT') {
        // Ignore comments here
      } else if (token.type === 'NEWLINE') {
        // Reset current indent and keep looking on next line
        indent = 0
      } else {
        foundToken = true
        break
      }
    }

    if (inBlock && !foundToken) {
      this.state.eof = true
    }

    if (!inBlock && indent < this.currentIndentLevel()) {
      throw new Error(`missing indent, found: ${indent}, expected at least ${this.currentIndentLevel()}`)
    }

    this.state.pos = pos
    return indent
  }

  private peekToken(): Token | undefined {
    for (let i = this.state.pos; i < this.tokens.length; i++) {
      if (!isTrivia(this.tokens[i].type)) {
        return this.tokens[i]
      }
    }
    return undefined
  }

  private peekTokenThroughNewlines(): Token | undefined {
    for (let i = this.state.pos; i < this.tokens.length; i++) {
      const ttype = this.tokens[i].type
      if (!isTrivia(ttype) && ttype !== 'NEWLINE') {
        return this.tokens[i]
      }
    }
    return undefined
  }

  private takeToken(): Token {
    for (let i = this.state.pos; i < this.tokens.length; i++) {
      if (!isTrivia(this.tokens[i].type)) {
        this.state.pos = i + 1
        return this.tokens[i]
      }
    }
    throw new Error('Ran out of tokens')
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

  private parseFunctionCallArgument(exprOpts?: ParseExpressionState): nodes.Expression | nodes.SplatExpression | undefined {
    const expr = this.parseExpression(exprOpts)
    if (!expr) {
      return undefined
    }
    if (this.peekToken()?.type === '...') {
      this.takeToken()
      return new nodes.SplatExpression(expr)
    }
    return expr
  }

  private parseImplicitFunctionCallArguments(): nodes.Expression[] | undefined {
    const state = this.cloneState()
    const exprOpts = { implicitFcallArg: true }
    const firstArg = this.parseFunctionCallArgument(exprOpts)
    if (!firstArg) {
      // Implicit function calls need at least one argument in the same line as
      // function call target
      this.state = state
      return undefined
    }

    const args = [firstArg]
    if (this.peekToken()?.type !== ',') {
      return args
    }
    this.takeToken()

    let hadComma = true
    const blockIndent = this.currentIndentLevel()
    let impBlockIdent: number | undefined = undefined
    while (true) {
      if (this.peekNewline()) {
        const lastPos = this.state.pos
        const newIndent = this.moveToNextLine(true)
        if (newIndent > blockIndent) {
          impBlockIdent = newIndent
        }

        if (!hadComma) {
          if (newIndent <= blockIndent) {
            // end of block
            this.state.pos = lastPos // give back the newlines
            break
          }

          if (impBlockIdent === undefined) {
            throw new Error("unexpected indentation")
          }

          if (newIndent <= impBlockIdent) {
            // end of this implicit call args
            this.state.pos = lastPos // give back the newlines
            break
          }
        } else {
          if (newIndent < blockIndent) {
            throw new Error("missing indentation")
          }
        }
      }

      const expr = this.parseFunctionCallArgument(exprOpts)
      if (!expr) {
        if (hadComma) {
          throw new Error('Expected another expression after comma')
        } else {
          break
        }
      }
      args.push(expr)

      hadComma = this.peekToken()?.type === ','
      if (hadComma) {
        this.takeToken()
      }
    }

    return args
  }

  private parseFunctionCall(): nodes.FunctionCall | undefined {
    const state = this.cloneState()
    // Do not recurse on function call rule, we handle chained calls through a
    // loop in the rule itself.
    this.state.inFCall++
    const target = this.parseIdentifier() ??
      this.parseThisAccess() ??
      this.parseParentesiszedExpr()
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
      if (this.peekSpace()) {
        // If there is a whitespace before argument list, it has to be
        // "implicit" function call without parentheses.

        // Function call arguments here are handled by another function because
        // how complicated the rules are...
        const args = this.parseImplicitFunctionCallArguments()
        if (!args) {
          break
        }
        chainFCall(args)
      } else if (this.peekToken()?.type === '(') {
        this.takeToken()
        if (this.peekNewline()) {
          this.moveToNextLine()
        }
        const args: nodes.Expression[] = []
        const firstArg = this.parseFunctionCallArgument()
        if (firstArg) {
          args.push(firstArg)
          while (this.peekToken()?.type === ',') {
            this.takeToken()
            if (this.peekNewline()) {
              this.moveToNextLine()
            }
            const arg = this.parseFunctionCallArgument()
            if (!arg) {
              throw new Error("Expected an expression after ',' in function call")
            }
            args.push(arg)
          }
        }

        if (this.peekNewline()) {
          this.moveToNextLine()
        }
        if (this.takeToken()?.type !== ')') {
          throw new Error('Expected ) in function call')
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

  // Parse `x for x in arr`, so an expression followed by a forExpression.
  private parseForExpression2(opts?: ParseExpressionState): nodes.Expression | undefined {
    const expr = this.parseBinaryExpr(opts)
    if (!expr) {
      return undefined
    }
    if (opts?.implicitFcallArg) {
      // Do not parse ForExpression2 as implicit function call argument, make
      // parsing less greedy in this case.
      // This lets us parse stuff like `foo x for x in arr` as
      // `foo(x) for x in arr` instead of `foo(x for x in arr)`.
      return expr
    }
    if (this.peekToken()?.type !== 'FOR') {
      return expr
    }
    // const state = this.cloneState()
    const forExpr = this.parseForExpression(opts, true /* binaryForExpr */)
    if (!forExpr) {
      throw new Error(`We are in for expression but 'for' could not be parsed, at '${this.peekToken()?.val}'`)
    }
    return new nodes.ForExpression2(expr, forExpr)
  }

  private parseBinaryExpr(opts?: ParseExpressionState): nodes.Expression | undefined {
    let left = this.parseUnaryExpr(opts)
    if (!left) {
      return undefined
    }
    while (isBinary(this.peekToken())) {
      if (opts?.implicitFcallArg && ['IF', 'UNLESS'].includes(this.peekToken()?.type ?? '')) {
        // `x if y` is not a valid expression as implicit function
        // call argument, because we want to parse something like this:
        // `foo x if y"
        // as "foo(x) if y", and not "foo(x if y)".

        // Breaking here when 'IF' / 'UNLESS' is encountered will make the
        // parsing less greedy and hoist this construct higher.
        break
      }
      const opToken = this.takeToken()
      if (this.peekNewline()) {
        this.moveToNextLine()
      }
      const right = this.parseUnaryExpr()
      if (!right) {
        throw new Error(`parse error after ${opToken.val}`)
      }
      if (left instanceof nodes.BinaryExpression) {
        // TODO: Make sure all operator priorities are defined
        if (operatorPriority[opToken.val] === undefined) {
          throw new Error(`undefined operator priority for '${opToken.val}'`)
        }
        if (operatorPriority[left.operator.val] === undefined) {
          throw new Error(`undefined operator priority for '${left.operator.val}'`)
        }
        if (operatorPriority[opToken.val] > operatorPriority[left.operator.val]) {
          left.right = new nodes.BinaryExpression(left.right, opToken, right)
          continue
        }
      }
      left = new nodes.BinaryExpression(left, opToken, right)
    }
    return left
  }

  private parseLoopExpression(): nodes.LoopExpression | undefined {
    if (this.peekToken()?.type !== 'LOOP') {
      return undefined
    }
    const operator = this.takeToken()
    const block = this.parseBlock()
    if (!block) {
      throw new Error(`Expected a block in a '${operator.val} expression`)
    }
    if (block.expressions.length === 0) {
      throw new Error(`Empty block in a '${operator.val}' expression`)
    }
    return new nodes.LoopExpression(operator, undefined /* condition */, block)
  }

  private parseUntilExpression(): nodes.LoopExpression | undefined {
    if (this.peekToken()?.type !== 'UNTIL') {
      return undefined
    }
    const operator = this.takeToken()
    const condition = this.parseExpression()
    if (!condition) {
      throw new Error(`Expected an expression after '${operator.val}'`)
    }
    if (this.peekToken()?.type === 'THEN') {
      const then = this.takeToken()
      if (this.peekNewline()) {
        throw new Error(`Unexpected newline after '${then.val}'`)
      }
    }
    const block = this.parseBlock()
    if (!block) {
      throw new Error(`Expected a block in a '${operator.val} expression`)
    }
    if (block.expressions.length === 0) {
      throw new Error(`Empty block in a '${operator.val}' expression`)
    }
    return new nodes.LoopExpression(operator, condition, block)
  }

  private parseForExpression(opts?: ParseExpressionState, binaryForExpr?: boolean): nodes.ForExpression | undefined {
    if (opts?.implicitFcallArg) {
      // ForExpression will never occur in implicit function call
      // because something like `foo for x in arr` will always be
      // parsed as ForExpression2, never as `foo(for x in arr)`.
      return undefined
    }
    if (this.peekToken()?.type !== 'FOR') {
      return undefined
    }
    const operator = this.takeToken()
    const iter1 = this.parseLeftHandValue()
    if (!iter1) {
      throw new Error(`Expected left-hand value after '${operator.val}', at '${this.peekToken()?.val}'`)
    }
    let iter2 = undefined
    if (this.peekToken()?.type === ',') {
      const comma = this.takeToken()
      // Second component of target.
      iter2 = this.parseLeftHandValue()
      if (!iter2) {
        throw new Error(`Expected left-hand value after '${comma.val}' in '${operator.val}' expression, at '${this.peekToken()?.val}'`)
      }
    }
    const iterType = this.takeToken()
    if (!['IN', 'OF'].includes(iterType.type)) {
      throw new Error(`Expected 'in' or 'of' after iterator, got '${iterType.val}`)
    }
    const target = this.parseExpression()
    if (!target) {
      throw new Error(`Expected an expression after '${operator.val}'`)
    }
    if (this.peekToken()?.type === 'THEN') {
      const then = this.takeToken()
      if (this.peekNewline()) {
        throw new Error(`Unexpected newline after '${then.val}'`)
      }
    }
    let block = undefined
    if (!binaryForExpr) {
      block = this.parseBlock()
      if (!block) {
        throw new Error(`Expected a block in a '${operator.val} expression`)
      }
      if (block.expressions.length === 0) {
        throw new Error(`Empty block in a '${operator.val}' expression`)
      }
    }
    return new nodes.ForExpression(operator, iter1, iter2, iterType, target, block)
  }

  private parseAnyLoopExpression(opts?: ParseExpressionState) {
    return this.parseLoopExpression() ??
      this.parseUntilExpression() ??
      this.parseForExpression(opts)
  }

  private parseIfExpression(opts?: ParseExpressionState): nodes.IfExpression | undefined {
    if (!['IF', 'UNLESS'].includes(this.peekToken()?.type ?? '')) {
      return undefined
    }
    const state = this.cloneState()
    const operator = this.takeToken()
    const condition = this.parseExpression()
    if (!condition) {
      throw new Error(`Expected an expression after ${operator.val}`)
    }
    if (this.peekToken()?.type === 'THEN') {
      const then = this.takeToken()
      if (this.peekNewline()) {
        throw new Error(`Unexpected newline after '${then.val}'`)
      }
    } else if (!this.peekNewline()) {
      if (opts?.implicitFcallArg) {
        this.state = state
        return undefined
      }
      throw new Error(`Unexpected after condition in if statement: ${this.peekToken()?.val}`)
    }
    const block = this.parseBlock(false /* rootBlock */, true /* inIfExpr */)
    if (!block) {
      throw new Error(`Expected a block`)
    }
    if (block.expressions.length === 0) {
      if (opts?.implicitFcallArg) {
        // TODO: Exiting cleanly here is needed, otherwise `v() if v` does not
        // parse correctly. Make sure that's ok.
        this.state = state
        return undefined
      }
      throw new Error(`Empty block in an '${operator.val}'`)
    }

    let elsePart = undefined
    if (this.peekToken()?.type === 'ELSE') {
      const elseTok = this.takeToken()
      if (['IF', 'UNLESS'].includes(this.peekToken()?.type ?? '')) {
        elsePart = this.parseIfExpression()
      } else {
        // inIfExpr = false so we throw if we see another 'ELSE'.
        elsePart = this.parseBlock(false /* rootBlock */, false /* inIfExpr */)
        if (!elsePart) {
          throw new Error(`Expected a block after '${elseTok.val}'`)
        } else if (elsePart.expressions.length === 0) {
          throw new Error(`Empty block after '${elseTok.val}'`)
        }
      }
    }

    return new nodes.IfExpression(operator, condition, block, elsePart)
  }

  private parseLeftHandValue() {
    return this.parseIdentifier() ?? this.parseThisAccess()
  }

  private parseAssign(): nodes.Assign | undefined {
    const state = this.cloneState()
    const target = this.parseLeftHandValue()
    if (!target) {
      return undefined
    }
    if (this.peekToken()?.type !== 'ASSIGN_OPERATOR') {
      this.state = state
      return undefined
    }
    const operator = this.takeToken()

    // TODO: Implement assignment chaining here
    // `a = b = c = 1`

    let opts: ParseExpressionState | undefined = undefined
    if (this.peekNewline()) {
      const indent = this.moveToNextLine()

      // TODO: CoffeeScript doesn't care if object literals start on the same
      // indentation level, things like:

      // obj =
      // a : 1
      // b : 2
      // c = 3

      // are legal, and parse to: `obj = {a : 1, b : 2}; c = 3;`.
      if (indent >= this.currentIndentLevel()) {
        // Assignment starts a new "implicit block". Important for things like
        // object literals, which parse differently if they were started in the
        // same line, compared to next line.
        opts = { exprIndent: indent }
      }
    }

    const value = this.parseExpression(opts)
    if (!value) {
      throw new Error("Expected an expression after assignment operator")
    }

    return new nodes.Assign(target, operator, value)
  }

  private parseObjectLiteral(opts?: ParseExpressionState): nodes.ObjectLiteral | undefined {
    let isBracketed = false
    if (this.peekToken()?.type === '{') {
      // '{' always starts an object, making the parsing more straightforward
      // here. We will rarely have to unwind everything and return undefined,
      // usually unexpected tokens will be syntax errors.
      this.takeToken()
      isBracketed = true
    } else {
      // We need to lookahead enough to see if it resembles object literal.
      // TODO: Speed-up with more complicated peek instead of cloning state.
      const state = this.cloneState()
      const hasKey = this.parseIdentifier() ?? this.parseNumber() ?? this.parseStringLiteral()
      if (!hasKey) {
        return undefined
      }
      const hasColon = this.peekToken()?.type === ':'
      this.state = state
      if (!hasColon) {
        return undefined
      }
    }

    // Object starts on the same line in e.g. assignment, function call argument list etc.
    let inlineObject = (opts?.exprIndent) === undefined

    let lastIndent = opts?.exprIndent ?? this.currentIndentLevel()
    let minIndent = lastIndent

    if (isBracketed && this.peekNewline()) {
      // Should throw an error on unexpected un-indent here (indent level
      // smaller than current block).
      const firstIndent = this.moveToNextLine()
      if (firstIndent < lastIndent) {
        throw new Error('Missing indent. Object literal body needs at least same indentation as parent expression.')
      }
      lastIndent = firstIndent
    }

    // For "unbrackated rule", save state before every newline, in case we stop
    // matching "key : value" and we need to roll back and break out. This is
    // for cases where de-indent does not signify end of object, because it's
    // indented on the same level as rest of the block.

    // E.g.:

    // a =
    // b : 1
    // c : 2
    // hello()

    // Should yield: `a = {b: 1, c: 2}; hello();`
    let stateBeforeNewline: ParserState | undefined
    let hadComma = false
    let hadNewline = false

    const ret = new nodes.ObjectLiteral()
    for (; ;) {
      if (isBracketed && this.peekToken()?.type === '}') {
        // End of object.
        break
      }
      const id = this.parseIdentifier() ?? this.parseNumber() ?? this.parseStringLiteral()
      if (!id) {
        if (isBracketed) {
          throw new Error(`Expected identifier, number, or string literal after '{', got: '${this.peekToken()?.val}'`)
        } else {
          break
        }
      }
      if (this.peekToken()?.type !== ':') {
        if (isBracketed || !hadNewline) {
          throw new Error(`Expected ':' after identifier in object body,  got '${this.peekToken()?.val}`)
        } else {
          if (!stateBeforeNewline) { throw new Error("BUG: stateBeforeNewline is undefined here") }
          this.state = stateBeforeNewline
          break
        }
      }
      const colon = this.takeToken()

      let exprOpts: ParseExpressionState | undefined = undefined
      if (this.peekNewline()) {
        const exprIndent = this.moveToNextLine()
        if (exprIndent <= lastIndent) {
          throw new Error('Missing indent. When object value starts on separate line, it has to be indented forward.')
        }
        exprOpts = { exprIndent }
      } else {
        exprOpts = { exprIndent: lastIndent }
      }
      const value = this.parseExpression(exprOpts)
      if (!value) {
        throw new Error(`Expected an expression after ':'`)
      }
      ret.properties.push({
        propertyId: id,
        value: value,
      })

      // Consume optional comma, checking for indentation rules. Note that if
      // we get comma here, we expect another key:value afterwards in the next
      // line or so, not end of object.
      hadComma = false
      if (this.peekTokenThroughNewlines()?.type === ',') {
        if (this.peekNewline()) {
          const commaIndent = this.moveToNextLine()
          if (commaIndent < lastIndent) {
            // preCommaIndent does not generate "unexpected indent" errors, but
            // affects current implicit indentation level. Stuff like this is
            // legal:

            // a = {
            //   a : 1
            //          ,
            //   b : 2
            // }

            // but something like this is not, because comma "brought the
            // indentation level back".

            // a = {
            //     a : 1
            //   ,
            //     b : 2
            // }
            lastIndent = commaIndent
          }
          if (commaIndent < minIndent) {
            // But if there is a minimum indent for the block, commma can't be
            // farther back than that.
            throw new Error('Missing indentation. Everything in object block has to be indented at least to that block.')
          }
        }

        const comma = this.takeToken()
        if (comma.type !== ',') {
          throw new Error(`BUG: Tried to consume ',', ended up with: ${comma.val} (${comma.type})`)
        }
        hadComma = true
      }

      hadNewline = false
      if (this.peekNewline()) {
        // Clone state for case that we are rewinding `moveToNextLine`. This
        // can only happen in unbracketed object literals, where deindent means
        // end of object.
        if (!isBracketed) {
          stateBeforeNewline = this.cloneState()
        }

        // Pass true to inBlock if we are in non-bracketed object literal - the
        // way we parse it resembles a block, and we need to be able to detect
        // that we are out of the object body. Otherwise it throws on
        // de-indent.
        const inBlock = !isBracketed
        const newIndent = this.moveToNextLine(inBlock)
        if (this.peekToken()?.type === '}') {
          // End of object. We don't care about indentation of '}'.
          break
        }

        if (newIndent > lastIndent) {
          throw new Error(`Unexpected indent. Key in an object body has to be indented at least to the level of previous object. (in this case indent=${lastIndent}, got ${newIndent})`)
        }
        if (newIndent < minIndent) {
          if (isBracketed) {
            throw new Error('Missing indentation. Everything in object block has to be indented at least to that block.')
          } else {
            if (!stateBeforeNewline) { throw new Error("BUG: stateBeforeNewline is undefined here") }
            this.state = stateBeforeNewline
            break
          }
        }

        if (!isBracketed && inlineObject && !hadComma) {
          // Even if indent is fine, inlineObjects always need commas between
          // object keys.
          if (!stateBeforeNewline) { throw new Error("BUG: stateBeforeNewline is undefined here") }
          this.state = stateBeforeNewline
          break
        }
        lastIndent = newIndent

        hadNewline = true
      }
    }

    if (isBracketed) {
      const closingBr = this.takeToken()
      if (closingBr.type !== '}') {
        throw new Error(`Expected '}' to close the object, got: '${closingBr.val}'`)
      }
    }

    return ret
  }

  private parseFunctionParam(): nodes.FunctionParam | undefined {
    const param = this.parseIdentifier() // TODO: Or object literal, or array literal
    if (!param) {
      return undefined
    }

    const state = this.cloneState()
    let defaultValue = undefined
    let splat = false
    if (this.peekToken()?.type === 'ASSIGN_OPERATOR' && this.peekToken()?.val === '=') {
      this.takeToken()
      defaultValue = this.parseExpression()
      if (!defaultValue) {
        this.state = state
        return undefined
      }
    } else {
      splat = this.peekToken()?.type === '...'
      if (splat) {
        this.takeToken()
      }
    }

    return { param, defaultValue, splat }
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

  private parseThisAccess(): nodes.PropertyAccess | undefined {
    const maybeShortThis = this.peekToken()
    if (maybeShortThis?.type === 'SHORT_THIS') {
      const pos = this.state.pos
      const shortThis = this.takeToken() // take '@'
      if (this.peekSpace()) {
        this.state.pos = pos
        return undefined
      }
      const id = this.parseIdentifier()
      if (!id) {
        throw new Error(`unexpected ${this.peekToken()?.val} after '@'`)
      }
      return new nodes.PropertyAccess(new nodes.ThisExpression(shortThis), id)
    }
    return undefined
  }

  private parseUnaryExpr(opts?: ParseExpressionState): nodes.Expression | undefined {
    // Check for prefix unary operation
    const maybePrefix = this.peekToken()
    if (maybePrefix && isUnary(maybePrefix)) {
      const pos = this.state.pos
      const prefixOp = this.takeToken()
      if (opts?.implicitFcallArg && this.peekSpace()) {
        // In expression like 'a - b', do not consider '- b' to be an unary
        // expression, because then we would end up parsing it as 'a(-b)'.
        //
        // However', 'a -b' should actually be parsed as 'a(-b)'.
        this.state.pos = pos
        return undefined
      }
      if (this.peekNewline()) {
        this.moveToNextLine()
      }
      const expr = this.parsePrimaryExpr()
      if (!expr) {
        throw new Error(`Expected expression after unary operator '${prefixOp.val}'`)
      }
      return new nodes.PrefixUnaryExpression(prefixOp, expr)
    }

    const expr = this.parsePrimaryExpr(opts)

    // Check for postfix unary operation
    if (expr && !this.peekSpace()) {
      const maybePostfix = this.peekToken()
      if (maybePostfix && maybePostfix.type === 'OPERATOR' && ['++', '--'].includes(maybePostfix.val)) {
        const postfixOp = this.takeToken()
        return new nodes.PostfixUnaryExpression(postfixOp, expr)
      }
    }
    return expr
  }

  private parseBuiltinPrimary(): nodes.BuiltinPrimaryExpression | undefined {
    const maybeBP = this.peekToken()
    if (maybeBP?.type === 'BUILTIN_PRIMARY') {
      return new nodes.BuiltinPrimaryExpression(this.takeToken())
    }
    return undefined
  }

  private parsePrimaryExpr(opts?: ParseExpressionState): nodes.Expression | undefined {
    // `exprIndent` is used in assignments and object literals - set to indent
    // level when assignment creates a new "implicit block" for upcoming
    // expression, e.g.:

    // a = # <- implicit block starts with the following newline
    //   b : 1
    //   c : 2

    // or:

    // a = {
    //   b : # <- implicit block starts with the following newline
    //     c : d
    // }

    // Primary expressions:
    const simple =
      this.parseFunction() ??
      this.parseObjectLiteral(opts) ??
      this.parseFunctionCall() ??
      this.parseIfExpression(opts) ??
      this.parseAnyLoopExpression(opts) ??
      this.parseAssign() ??
      this.parseNumber() ??
      this.parseStringLiteral() ??
      this.parseIdentifier() ??
      this.parseBuiltinPrimary() ??
      this.parseThisAccess()

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
    this.state.inParens--
    return new nodes.Parens(expr)
  }

  private parseExpression(opts?: ParseExpressionState): nodes.Expression | undefined {
    // Start with `ForExpression2` which is the `x for x in arr` syntax. We
    // will try to parse a BinaryExpression and then look if it's followed by
    // 'FOR' token. If it is, we are dealing with ForExpression2, if not, just
    // return the binary expression.
    //
    // Not the cleanest solution but is probably the cheapest here.
    return this.parseForExpression2(opts)
  }

  private parseReturn(): nodes.Node | undefined {
    if (this.peekToken()?.type !== 'RETURN') {
      return undefined
    }
    this.takeToken()

    // Expression after return is optional
    const expr = this.parseExpression()
    return new nodes.ReturnStatement(expr)
  }

  private parseStatement(): nodes.Node | undefined {
    return this.parseReturn() ??
      this.parseExpression()
  }

  // Returns last semicolon taken if there was more than one, or undefined if
  // there wasn't any. This is used in blocks to parse stuff like:
  // foo = ->
  //    hello();;;;world();
  private parseOneOrMoreSemicolons(): Token | undefined {
    let ret = undefined
    for(;;) {
      const semicolon = this.peekToken()
      if(semicolon?.type === ';') {
        ret = this.takeToken()
      } else {
        break
      }
    }
    return ret
  }

  private parseBlock(rootBlock?: boolean, inIfExpr?: boolean) {
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
    // closing parenthesis and return the block.

    const lastIndent = this.state.indentStack[this.state.indentStack.length - 1] as number | undefined

    if (rootBlock || this.peekToken()?.type === 'NEWLINE') {
      // either a root block, or block starting on the next line (e.g. after
      // function def. token).
      let blockIndent: number | undefined = undefined;

      blockLoop: for (; ;) {
        const lineStartPos = this.state.pos
        const indent = this.moveToNextLine(true /* inBlock */)

        if (blockIndent === undefined) {
          blockIndent = indent
          if (!rootBlock && indent === lastIndent) {
            // empty block, we immediately indented back to previous block
            // indentation.
            // e.g.:
            //
            // foo = () ->
            // bar = foo()
            //
            // block of function assigned to `foo` ends immediately, without any tokens.
            // it's an empty block.
            this.state = state
            return block
          }

          this.state.indentStack = [...this.state.indentStack, blockIndent]
          block.indent = blockIndent
        } else {
          if (indent < blockIndent) {
            if (rootBlock && !this.state.eof) {
              // root block cannot end with de-indent
              throw new Error("Missing indentation in root block")
            }
            // end of block
            this.state.pos = lineStartPos
            break
          } else if (indent > blockIndent) {
            throw new Error("unexpected indentation")
          }
        }

        for (; ;) {
          // One or more statements separated by semicolons.
          const statement = this.parseStatement()
          if (!statement) {
            break blockLoop
          }
          block.expressions.push(statement)
          this.parseOneOrMoreSemicolons()
          if(this.peekNewline()) {
            break
          }
        }

        const separator = this.peekToken()
        if (!separator) {
          // End of token stream - just get out.
          break
        } else if (separator.type !== 'NEWLINE') {
          throw new Error(`Unexpected after expression: ${separator.val}`);
        }
      }

      // Done parsing the block.
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
          throw new Error(`Expected an expression (at '${this.peekToken()?.val}')`)
        }

        block.expressions.push(expr)
        const peekedTok = this.peekToken()
        switch (peekedTok?.type) {
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
              throw new Error(`Unexpected ${peekedTok?.val}`)
            }
          case 'ELSE':
            if (inIfExpr) {
              break loop
            } else {
              throw new Error(`Unexpected '${peekedTok?.val}'`)
            }
          default:
            throw new Error(`Unexpected ${peekedTok?.val}`)
        }
      }
    }

    return block
  }

  public parse() {
    const block = this.parseBlock(true /* rootBlock */)

    // TODO: very inefficient to do both peekToken and takeToken in a loop.
    // This is probably not the only place that does this.
    while (this.peekToken()) {
      const token = this.takeToken()
      if (token.type !== 'NEWLINE') {
        // TODO: Ideally we would try to resume parsing here to try to tell
        // user what happened. E.g. maybe there's a letfover expression here
        // somehow.
        console.log('leftovers:', token, this.tokens.slice(this.state.pos))
        throw new Error('found leftover tokens')
      }
    }

    return block
  }
}
