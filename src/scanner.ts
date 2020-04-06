
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
    '->': 'FUNC',
    '=>': 'FUNC',
    '+': 'OPERATOR',
    '-': 'OPERATOR',
    '/': 'OPERATOR',
    '*': 'OPERATOR',
    '^': 'OPERATOR',
    '|': 'OPERATOR',
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

export function isTrivia(type: TokenType) {
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

    private scanIdentifier(): Token | null {
        return this.scanRegexp(identifierRxp, 'IDENTIFIER')
    }

    private scanNumber(): Token | null {
        return this.scanRegexp(numberRxp, 'NUMBER')
    }

    private scanWhitespace() : Token | null {
        return this.scanRegexp(whitespaceRxp, 'WHITESPACE')
    }

    private scanComment(): Token | null {
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

    private scanCommon(): Token | null {
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

    protected consumeChunk(len: number) {
        this.pos += len
        this.chunk = this.chunk.substr(len)
    }

    public scan(): Token[] {
        console.log(this.contents)

        this.chunk = this.contents

        const tokens : Token[] = []
        function pushToken(t: Token) {
            // console.log(t)
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
        }

        return tokens
    }
}
