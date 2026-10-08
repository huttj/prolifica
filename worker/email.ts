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
