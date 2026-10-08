import { config } from "../config.js"

export type PermissionFamily = "A" | "DV" | "DI" | "M"
export type Permission = {
  family: PermissionFamily
  rank: number
}

export type PermissionIdentifier =
  | { tgid: number }
  | { nfid: string }

const permissionApi = new URL(config.permissions.api_url)

export async function getPermission(identifier: PermissionIdentifier): Promise<Permission> {
  const command = "tgid" in identifier
    ? `get permission bytgid ${identifier.tgid}`
    : `get permission bynfid ${identifier.nfid}`

  const url = new URL(permissionApi)
  url.searchParams.set("query", command)

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`permission API returned ${response.status}`)
  }

  const body = await response.text()
  const family = body.match(/Family\s*:\s*(A|DV|DI|M)\b/i)?.[1]?.toUpperCase() as PermissionFamily | undefined
  const rankLiteral = body.match(/Rank\s*:\s*([0-9A-F])\b/i)?.[1]

  if (!family || rankLiteral === undefined) {
    throw new Error("invalid permission API response")
  }

  return {
    family,
    rank: parseInt(rankLiteral, 16),
  }
}
