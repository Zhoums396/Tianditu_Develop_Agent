export function decodeBase64Text(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const text = value.trim()
    const payload = text.startsWith('r1:')
      ? text.slice(3).split('').reverse().join('')
      : text
    return Buffer.from(payload, 'base64').toString('utf-8')
  } catch {
    return undefined
  }
}

export function readTextField(body: any, plainKey: string, encodedKey: string): string | undefined {
  const decoded = decodeBase64Text(body?.[encodedKey])
  if (decoded != null) return decoded
  const plain = body?.[plainKey]
  return typeof plain === 'string' ? plain : undefined
}
