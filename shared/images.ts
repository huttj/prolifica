// Images pasted into a comment or an ask are the person's data (image data, in pasted/), and sit
// in the text where they were pasted as markdown image links to that data. Comments render them
// in place; an ask hands the AI their ids, to look at with read_data.

const TOKEN = /!\[[^\]\n]*\]\(\/api\/data\/([a-z0-9]+)\/raw\)/g

export const imageUrl = (id: string) => `/api/data/${id}/raw`
export const imageToken = (id: string) => `![image](${imageUrl(id)})`

/** The text cut into runs of text and images, in order. */
export function splitImages(text: string): ({ text: string } | { id: string })[] {
  const out: ({ text: string } | { id: string })[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push({ id: m[1] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** The ids of the images in a text, in order, once each. */
export const imagesIn = (text: string) => [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))]

/** The text for an AI that reads text only: each image becomes its data id, to look at with read_data. */
export function forAi(text: string): string {
  if (!imagesIn(text).length) return text
  return `${text.replace(TOKEN, (_, id: string) => `[image ${id}]`)}\n\n(Each [image <id>] is Prolifica data: look at it with read_data.)`
}
