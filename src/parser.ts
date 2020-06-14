import { Token, isTrivia } from './scanner'
import * as nodes from './nodes'
import { start } from 'repl'

const operatorPriority: { [k: string]: number } = {
  '+': 50,
  '-': 50,
  '*': 100,
  '/': 100,
}

interface ParserState {
  pos: number
  inFCall: number
  inFCallImplicitArgs: number // trying to descend into function call without parentheses

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
  return !!token && token.type === 'OPERATOR' && ['+', '-', '*', '/', '|'].includes(token.val)
}

export class Parser {
  tokens: Token[] = []
  state: ParserState = {} as ParserState

  public reset(tokens: Token[]) {
    this.tokens = tokens
    this.state = {
      pos: 0,
      inFCall: 0,
      inFCallImplicitArgs: 0,
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
      throw new Error("missing indent")
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

  private parseFunctionCallArgument(): nodes.Expression | nodes.SplatExpression | undefined {
    const expr = this.parseExpression()
    if(!expr) {
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
    this.state.inFCallImplicitArgs++
    const firstArg = this.parseFunctionCallArgument()
    if (!firstArg) {
      // Implicit function calls need at least one argument in the same line as
      // function call target
      this.state = state
      return undefined
    }

    const args = [firstArg]
    if (this.peekToken()?.type !== ',') {
      this.state.inFCallImplicitArgs--
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

      const expr = this.parseFunctionCallArgument()
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

    this.state.inFCallImplicitArgs--
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

  private parseBinaryExpr(): nodes.Expression | undefined {
    let left = this.parseUnaryExpr()
    if (!left) {
      return undefined
    }
    while (isBinary(this.peekToken())) {
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
          throw new Error(`undefined operator priority for '${opToken.val}`)
        }
        if (operatorPriority[left.operator.val] === undefined) {
          throw new Error(`undefined operator priority for '${left.operator.val}`)
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

  private parseAssign(): nodes.Assign | undefined {
    const state = this.cloneState()
    const target = this.parseIdentifier() ?? this.parseThisAccess()
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

    let exprIndent: number | undefined = undefined
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
        exprIndent = indent
      }
    }

    const value = this.parseExpression(exprIndent)
    if (!value) {
      throw new Error("Expected an expression after assignment operator")
    }

    return new nodes.Assign(target, operator, value)
  }

  private parseObjectLiteral(exprIndent?: number): nodes.ObjectLiteral | undefined {
    let hadOpenBracket = false
    let currentIndent = this.currentIndentLevel()
    if (this.peekToken()?.type === '{') {
      this.takeToken()
      hadOpenBracket = true

      // Advance past newlines
      if (this.peekNewline()) {
        currentIndent = this.moveToNextLine()
      }
    }

    let obj : nodes.ObjectLiteral | undefined = undefined
    for (; ;) {
      const id = this.parseIdentifier() ?? this.parseStringLiteral() ?? this.parseNumber()
      if (!id) {
        if (hadOpenBracket) {
          throw new Error(`Expected string literal, number literal, or identifier in object, found: ${this.peekToken()?.val}`)
        } else {
          break
        }
      }

      const state = this.cloneState()
      const colon = this.takeToken()
      if (colon.type !== ':') {
        if (hadOpenBracket || obj) {
          throw new Error(`Expected ':', got ${colon.val}`)
        } else {
          this.state = state
          break
        }
      }

      const expr = this.parseExpression()
      if (!expr) {
        throw new Error("Expected expression after ':'")
      }

      if (!obj) {
        // First key-value pair, create ObjectLiteral
        obj = new nodes.ObjectLiteral()
      }

      obj.properties.push({ propertyId: id, value: expr })

      let next = this.peekToken()
      if (next?.type === 'NEWLINE') {
        this.moveToNextLine()
        next = this.peekToken()
      }
      if (!next) {
        throw new Error('ran out of tokens in the middle of object literal')
      }

      if (next.type === "}") {
        this.takeToken()
        break
      } else if (next.type === ',') {
        this.takeToken()
        continue
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
      if(splat) {
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

  private parseThisAccess(): nodes.Expression | undefined {
    const maybeShortThis = this.peekToken()
    if(maybeShortThis?.type === 'SHORT_THIS') {
      const pos = this.state.pos
      const shortThis = this.takeToken() // take '@'
      if(this.peekSpace()) {
        this.state.pos = pos
        return undefined
      }
      const id = this.parseIdentifier()
      if(!id) {
        throw new Error(`unexpected ${this.peekToken()?.val} after '@'`)
      }
      return new nodes.PropertyAccess(new nodes.ThisExpression(shortThis), id)
    }
    return undefined
  }

  private parseUnaryExpr(): nodes.Expression | undefined {
    // Check for prefix unary operation
    const maybePrefix = this.peekToken()
    if (maybePrefix && isUnary(maybePrefix)) {
      const pos = this.state.pos
      const prefixOp = this.takeToken()
      if (this.state.inFCallImplicitArgs > 0 && this.peekSpace()) {
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

    const expr = this.parsePrimaryExpr()

    // Check for postfix unary operation
    if(expr && !this.peekSpace()) {
      const maybePostfix = this.peekToken()
      if(maybePostfix && maybePostfix.type === 'OPERATOR' && ['++', '--'].includes(maybePostfix.val)) {
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

  private parsePrimaryExpr(exprIndent?: number): nodes.Expression | undefined {
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
      this.parseFunctionCall() ??
      this.parseAssign() ??
      this.parseNumber() ??
      this.parseStringLiteral() ??
      this.parseIdentifier() ??
      this.parseObjectLiteral(exprIndent) ??
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

  private parseExpression(exprIndent?: number): nodes.Expression | undefined {
    return this.parseBinaryExpr(exprIndent)
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

  private parseBlock(rootBlock?: boolean) {
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

      for (; ;) {
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
            if(rootBlock && !this.state.eof) {
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

        const statement = this.parseStatement()
        if (!statement) {
          break
        }
        block.expressions.push(statement)

        const separator = this.peekToken()
        if (!separator) {
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
    const block = this.parseBlock(true /* rootBlock */)

    // TODO: very inefficient to do both peekToken and takeToken in a loop.
    // This is probably not the only place that does this.
    while(this.peekToken()) {
      const token = this.takeToken()
      if(token.type !== 'NEWLINE') {
        // TODO: Ideally we would try to resume parsing here to try to tell
        // user what happened. E.g. maybe there's a letfover expression here
        // somehow.
        throw new Error('found leftover tokens')
      }
    }

    return block
  }
}
