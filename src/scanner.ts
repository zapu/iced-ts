
const identifierRxp = /^(?!\d)([$\w\x7f-\uffff]+)/

export type TokenType = 'IDENTIFIER'

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

    public scanIdentifier(): Token | null {
        const m = this.chunk.match(identifierRxp)
        if (!m) {
            return null
        }
        const val = m[0]
        return {
            type: 'IDENTIFIER',
            consumed: val.length,
            val,
        }
    }

    public scan() {
        this.chunk = this.contents
        while(this.pos < this.contents.length) {
            const token = this.scanIdentifier()
            if (!token) {
                throw new Error("no token")
            }
            console.log(token)
            this.pos += token.consumed
            this.chunk = this.chunk.substr(token.consumed)
        }
    }
}


const contents = `hello = 1`
const scanner = new Scanner()
scanner.reset(contents)
scanner.scan()