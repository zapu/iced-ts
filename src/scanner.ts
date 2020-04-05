
const whitespaceRxp = /^[ \t]+/
const numberRxp = /^[0-9]+/
const identifierRxp = /^(?!\d)([$\w\x7f-\uffff]+)/

export type TokenType = 'BLOCK_START' | 'BLOCK_END' |
    'IDENTIFIER' | 'NUMBER' | 'COMMENT' | 'NEWLINE' |
    'WHITESPACE' | '=' | 'OPERATOR' | 'FUNC' | 'IS' |
    'CLASS' | 'RETURN' | 'IF' | 'UNLESS' | '(' | ')'|
    'UNARY' | 'UNARY_MATH'

const commonTokens : {[str: string]: TokenType} = {
    '\n': 'NEWLINE',
    '=': "=",
    '+': 'OPERATOR',
    '-': 'OPERATOR',
    '/': 'OPERATOR',
    '*': 'OPERATOR',
    '^': 'OPERATOR',
    '|': 'OPERATOR',
    '->': 'FUNC',
    '=>': 'FUNC',
    'return': 'RETURN',
    'if': 'IF',
    'unless': 'UNLESS',
    '(': '(',
    ')': ')',
    '!': 'UNARY_MATH',
    '~': 'UNARY_MATH',
    'new': 'UNARY',
    'typeof': 'UNARY',
    'delete': 'UNARY',
    // 'do': 'UNARY',
} as const

function isTrivia(type: TokenType) {
    switch (type) {
        case 'WHITESPACE':
        case 'COMMENT':
            return true
    }
    return false
}

export interface Token {
    type: TokenType
    val: string
    consumed: number
}

export class Scanner {
    contents: string = ""
    pos: number = 0
    chunk: string = ""

    reset(contents: string) {
        this.pos = 0
        this.contents = contents
    }

    public stash(): number {
        return this.pos
    }

    public rewind(newPos: number) {
        if (this.pos < newPos) {
            throw new Error("Trying to rewind scanner forward")
        }
        this.pos = newPos
        this.chunk = this.contents.substring(this.pos)
    }

    public findIndent(): number {
        const m = this.chunk.match(whitespaceRxp)
        if (!m) {
            return 0;
        } else {
            return m[0].length;
        }
    }

    private scanRegexp(pattern: RegExp, type: TokenType): Token | null {
        const m = this.chunk.match(pattern)
        if (!m) {
            return null
        }
        const val = m[0]
        return {
            type: type,
            consumed: val.length,
            val,
        }
    }

    public scanIdentifier(): Token | null {
        return this.scanRegexp(identifierRxp, 'IDENTIFIER')
    }

    public scanNumber(): Token | null {
        return this.scanRegexp(numberRxp, 'NUMBER')
    }

    public scanComment(): Token | null {
        if (this.chunk[0] === '#') {
            let newLinePos = this.chunk.indexOf('\n')
            if (newLinePos == -1) {
                // Comment till end of file
                newLinePos = this.chunk.length
            }
            return {
                type: 'COMMENT',
                consumed: newLinePos,
                val: this.chunk.substr(0, newLinePos),
            }
        }
        return null
    }

    public scanCommon(): Token | null {
        for (const text in commonTokens) {
            if (this.chunk.indexOf(text) === 0) {
                return {
                    type: commonTokens[text],
                    consumed: text.length,
                    val: this.chunk.substr(0, text.length),
                }
            }
        }
        return null
    }

    public scanWhitespace() : Token | null {
        const amount = this.findIndent()
        if (amount != 0) {
            return {
                type: 'WHITESPACE',
                consumed: amount,
                val: this.chunk.substr(0, amount),
            }
        }
        return null
    }

    protected consumeChunk(len: number) {
        this.pos += len
        this.chunk = this.chunk.substr(len)
    }

    public scan(): Token[] {
        console.log(this.contents)

        this.chunk = this.contents
        let indentLevel = this.findIndent()
        let blockDepth = 0

        const tokens : Token[] = []
        function pushToken(t: Token) {
            tokens.push(t)
        }

        while (this.pos < this.contents.length) {
            const token = this.scanCommon() ||
                this.scanIdentifier() ||
                this.scanNumber() ||
                this.scanComment() ||
                this.scanWhitespace()

            if (!token) {
                throw new Error("no token at")
            }

            pushToken(token)
            this.consumeChunk(token.consumed)

            if (token.type === 'NEWLINE') {
                const newIndentLevel = this.findIndent()
                if (newIndentLevel < indentLevel) {
                    if (blockDepth > 0) {
                        blockDepth--
                    }
                    indentLevel = newIndentLevel
                    pushToken({ type: 'BLOCK_END', val: '', consumed: newIndentLevel })
                    this.consumeChunk(newIndentLevel)
                } else if(newIndentLevel > indentLevel) {
                    blockDepth++
                    indentLevel = newIndentLevel
                    pushToken({ type: 'BLOCK_START', val: '', consumed: newIndentLevel })
                    this.consumeChunk(newIndentLevel)
                }
            }
        }

        // Filter out trivia for now
        return tokens.filter(x => !isTrivia(x.type))
    }
}
