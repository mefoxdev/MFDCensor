import { readFileSync } from "node:fs"
import { parse } from "smol-toml"

interface Config {
    app: {
        name: string
        debug: boolean
    }
    
    bot: {
        token: string
    }

    OwnerInfo: {
        OwnerID: number
    }

    permissions: {
        api_url: string
    }
}

const raw = readFileSync("config.toml", "utf8")

export const config = parse(raw) as unknown as Config
