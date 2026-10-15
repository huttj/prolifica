function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export async function sendMagicLink(env: Env, to: string, link: string, code: string) {
  const text = [
    'Here is your sign-in link for Prolifica:',
    '',
    link,
    '',
    `Or enter this code where you asked to sign in: ${code}`,
    '',
    'It works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.',
  ].join('\n')

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:34em">
<p>Here is your sign-in link for <strong>Prolifica</strong>:</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f3d3a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Sign in</a></p>
<p>Or enter this code where you asked to sign in: <strong style="font-size:20px;letter-spacing:3px">${code}</strong></p>
<p style="color:#666;font-size:13px">Or paste this into your browser:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
<p style="color:#666;font-size:13px">It works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.</p>
</div>`

  await env.EMAIL.send({ to, from: env.EMAIL_FROM, subject: `Prolifica sign-in: ${code}`, text, html })
}

/** A short note with one button. */
async function sendNote(env: Env, to: string, subject: string, lines: string[], link: string, button: string) {
  const text = [...lines, '', link].join('\n')
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:34em">
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f3d3a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">${escapeHtml(button)}</a></p>
</div>`
  await env.EMAIL.send({ to, from: env.EMAIL_FROM, subject, text, html })
}

/** To an admin: someone asked for more storage. */
export function sendStorageRequest(env: Env, to: string, who: string, used: string, quota: string, link: string) {
  return sendNote(env, to, `Prolifica: ${who} asks for more storage`, [`${who} asks for more storage on Prolifica. They use ${used} of ${quota}.`], link, 'Give them more')
}

/** To the person who asked: they have more now. */
export function sendStorageGranted(env: Env, to: string, quota: string, link: string) {
  return sendNote(env, to, 'Prolifica: you have more storage', [`You asked for more storage on Prolifica. You can now keep ${quota}.`], link, 'Your data')
}
