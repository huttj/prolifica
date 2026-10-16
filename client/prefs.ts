// Choices that belong to this browser, not to the account: where Codinger runs depends on the
// machine (this computer or the web hub), and so does how big a pasted image should be.

export type CodingerAt = 'web' | 'local'
export const CODINGER_URL: Record<CodingerAt, string> = { web: 'https://web.codinger.app', local: 'http://localhost:4545' }

export type ImageSize = 'small' | 'medium' | 'large'
/** The longest side of a pasted image, in pixels. */
export const IMAGE_SIDE: Record<ImageSize, number> = { small: 768, medium: 1024, large: 1568 }

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable */
  }
}

/** Where Codinger runs, or null until the person says (the first Ask in Codinger asks). */
export const codingerAt = (): CodingerAt | null => (read('pf:codingerAt') === 'local' ? 'local' : read('pf:codingerAt') === 'web' ? 'web' : null)
export const setCodingerAt = (at: CodingerAt) => write('pf:codingerAt', at)

export const imageSize = (): ImageSize => {
  const v = read('pf:imageSize')
  return v === 'small' || v === 'large' ? v : 'medium'
}
export const setImageSize = (size: ImageSize) => write('pf:imageSize', size)
