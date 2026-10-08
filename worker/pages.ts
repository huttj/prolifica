/** The few pages the worker renders itself: link confirmation and OAuth sign-in/consent. */

export const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function page(title: string, body: string, headers?: Headers, status = 200): Response {
  const h = headers ?? new Headers()
  h.set('content-type', 'text/html; charset=utf-8')
  h.set('x-frame-options', 'DENY')
  h.set('content-security-policy', "frame-ancestors 'none'")
  h.set('cache-control', 'no-store')
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Prolifica</title>
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#14211f;--muted:#5d6b68;--line:#e2ddd2;--accent:#0f6b61;--accent-ink:#fff;--warn:#9a5b00}
@media (prefers-color-scheme:dark){:root{--bg:#0f1514;--card:#162020;--ink:#e8efed;--muted:#97a6a3;--line:#26312f;--accent:#2fc4ae;--accent-ink:#07211d;--warn:#f0b35a}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
.brand{display:flex;gap:8px;align-items:center;font-weight:650;margin-bottom:18px;color:var(--accent)}
h1{font-size:21px;margin:0 0 8px;line-height:1.25}p{margin:8px 0;color:var(--muted)}strong{color:var(--ink)}
input{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);margin:6px 0}
button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:10px 16px;cursor:pointer;background:var(--accent);color:var(--accent-ink)}
button.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
.row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}.warn{color:var(--warn)}.small{font-size:13px}
.err{color:#c0392b}.hidden{display:none}
</style></head><body><main><div class="brand"><svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><circle cx="11" cy="18" r="7" fill="currentColor" opacity=".9"/><circle cx="22" cy="11" r="5" fill="currentColor" opacity=".6"/><circle cx="24" cy="23" r="3.5" fill="currentColor" opacity=".4"/></svg>Prolifica</div>${body}</main></body></html>`,
    { status, headers: h },
  )
}

/** The link in the email lands here; a click (not a prefetching mail scanner) spends it. */
export function confirmLinkPage(token: string, email: string) {
  return page(
    'Sign in',
    `<h1>Sign in as ${esc(email)}?</h1>
<form method="post" action="/auth/verify"><input type="hidden" name="token" value="${esc(token)}">
<div class="row"><button autofocus>Continue</button></div></form>
<script>document.forms[0].submit()</script>`,
  )
}

export function badLinkPage() {
  return page('Link expired', `<h1>That link has expired</h1><p>Sign-in links work once, for 15 minutes.</p><div class="row"><a href="/login"><button>Get a new one</button></a></div>`, undefined, 400)
}

/** Sign in from inside an OAuth authorization (claude.ai, Claude Code, ...): email, then the code from it. */
export function signInPage(next: string, clientName: string | null) {
  return page(
    'Sign in',
    `<h1>Sign in to connect ${clientName ? esc(clientName) : 'your agent'}</h1>
<p>We'll email you a link and a code. New here? This makes your account.</p>
<form id="ask"><input name="email" type="email" required placeholder="you@example.com" autocomplete="email" autofocus>
<div class="row"><button>Email me</button></div></form>
<form id="code" class="hidden"><p>Check your email. Click the link, or type the code here:</p>
<input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="7">
<div class="row"><button>Sign in</button></div></form>
<p id="msg" class="small"></p>
<script>
const next=${JSON.stringify(next).replace(/</g, '\\u003c')};let email='';
const msg=(t,err)=>{const m=document.getElementById('msg');m.textContent=t;m.className='small'+(err?' err':'')}
document.getElementById('ask').onsubmit=async(e)=>{e.preventDefault();email=e.target.email.value.trim();msg('Sending…')
 const r=await fetch('/api/auth/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,next})})
 const j=await r.json().catch(()=>({}));if(!r.ok)return msg(j.error||'Could not send',true)
 msg(j.dev?'Local dev: the link and code are in the terminal.':'');e.target.classList.add('hidden');document.getElementById('code').classList.remove('hidden');document.querySelector('#code input').focus()}
document.getElementById('code').onsubmit=async(e)=>{e.preventDefault();msg('Checking…')
 const r=await fetch('/api/auth/code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,code:e.target.code.value})})
 const j=await r.json().catch(()=>({}));if(!r.ok)return msg(j.error||'That code did not work',true);location.href=next}
</script>`,
  )
}

export function consentPage(details: { clientName: string; clientDomain?: string | null; redirectHost: string; redirectIsLoopback: boolean }, handle: string, who: string) {
  const name = esc(details.clientName)
  const origin = details.clientDomain ? `Published by <strong>${esc(details.clientDomain)}</strong>.` : 'This app registered itself; its name is not verified.'
  return `<h1>Let ${name} use Prolifica as you?</h1>
<p>Signed in as <strong>${esc(who)}</strong>.</p>
<p>It will be able to read and change your data and isles, and star and comment as you. ${origin}</p>
<p class="small">Access goes to <strong>${esc(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? '<p class="warn small"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>' : ''}
<form method="post"><input type="hidden" name="handle" value="${esc(handle)}">
<div class="row"><button name="decision" value="approve" autofocus>Allow</button><button class="secondary" name="decision" value="deny">Deny</button></div></form>`
}
