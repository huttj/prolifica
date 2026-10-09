import { useMemo, useRef, useState } from 'react'
import type { Dataset, Isle, IsleSources } from '../shared/types'
import { api } from './api'
import { AskAiButton } from './ask'
import { DataTree } from './DataTree'
import { DataSources } from './Sources'
import { Icon, Link, Modal, useAsync, useSession } from './ui'

/**
 * "Same look, my data". Your data is almost never in exactly the shape a page reads, so this doesn't
 * ask you to bind slots by hand: you bring the data (pick some, drop files, or say what to fetch) and
 * your AI fits it to the isle, publishes your version and tests it with check_isle until it works.
 */

export function myDataPrompt(isle: Isle, picked: Dataset[], fetchWhat: string, notes: string, origin: string, sources?: IsleSources) {
  const url = `${origin}/i/${isle.id}`
  const lines: string[] = []
  lines.push(`Using the Prolifica connector, make my own version of the isle "${isle.title}" (${isle.id}, ${url}) that shows my data instead of its own.`)
  lines.push('')
  lines.push(`1. Read it with get_isle, including its HTML, so you know what each slot really needs: the slot descriptions, and the fields the page actually reads.`)
  if (picked.length) {
    lines.push(`2. My data${fetchWhat ? ' so far' : ''}: read each with read_data.`)
    for (const d of picked) lines.push(`   - ${d.path} (${d.kind}, id ${d.id})`)
  }
  if (fetchWhat) {
    lines.push(`${picked.length ? '   Also collect' : '2. Collect'} this data: ${fetchWhat}`)
    lines.push(`   Before collecting from a website, call site with its URL and reuse a collector that has worked there. Save what you collect with write_data, with its source (url, method, notes, and the code you used).`)
  }
  if (sources?.sources.length) {
    const by = sources.sources.map((s) => `${s.dataset.path} (id ${s.dataset.id}${s.site ? `, from ${s.site}` : ''}${s.method ? `, ${s.method}` : ''}${s.code ? ', collector saved with it' : ''})`).join('; ')
    lines.push(`   For reference, this isle's own data came from: ${by}. Read the original's source notes (read_data) to see what shape it arrived in.`)
    if (sources.sources.some((s) => s.selfServe)) lines.push(`   Some of it was collected in a browser (a bookmarklet or extension), which only I can run: if I haven't given you that data, ask me to collect it and send you the file rather than trying to fetch it yourself.`)
  }
  lines.push(`3. Fit it to the slots. If a dataset isn't already in the shape a slot expects, write a transformed copy with write_data (derived_from the originals, transform saying what you did) and bind that. Never overwrite my originals. If something the page needs isn't in my data at all, tell me instead of inventing it.`)
  lines.push(`4. Publish with publish_isle, parent: "${isle.id}" and from: "${isle.id}" plus the new bindings (same page, my data). If the page has words tied to its original data written into it (a place name, a title), don't fork it just to change them: put them in the data and have the page read them. Only if my data can't be made to fit the page as it is, pass new html instead, changing as little as possible, with view: "same" if it's still the same view or "new" if it now looks or works differently.`)
  lines.push(`5. Test it with check_isle on your new isle (and at width 390 for phones). If there are errors, a slot didn't load, or the page looks empty or wrong in the screenshot, fix it and update in place (publish_isle with id and a note), then check again until it's clean.`)
  if (notes) {
    lines.push('')
    lines.push(`Also: ${notes}`)
  }
  lines.push('')
  lines.push(`When it works, tell me the link and what you did to my data to make it fit.`)
  return lines.join('\n')
}

export function UseMyDataModal({ isle, onClose }: { isle: Isle; onClose: () => void }) {
  const { me, toast } = useSession()
  const mine = useAsync(() => (me ? api.data() : Promise.resolve([] as Dataset[])), [me?.id])
  const [extra, setExtra] = useState<Dataset[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [fetchWhat, setFetchWhat] = useState('')
  const [notes, setNotes] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const all = useMemo(() => {
    const seen = new Set(extra.map((d) => d.id))
    return [...extra, ...(mine.data ?? []).filter((d) => !seen.has(d.id)).sort((a, b) => b.updatedAt - a.updatedAt)]
  }, [extra, mine.data])
  const picked = all.filter((d) => chosen.has(d.id))
  const setPicked = (ids: string[], on: boolean) => setChosen((c) => { const n = new Set(c); for (const id of ids) on ? n.add(id) : n.delete(id); return n })

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    setBusy((n) => n + list.length)
    for (const f of list) {
      try {
        const d = await api.upload(`uploads/${f.name}`, f)
        setExtra((x) => [d, ...x.filter((o) => o.id !== d.id)])
        setChosen((c) => new Set(c).add(d.id))
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`)
      } finally {
        setBusy((n) => n - 1)
      }
    }
  }

  const slots = Object.entries(isle.slots)
  const ready = picked.length > 0 || fetchWhat.trim().length > 0
  const srcs = useAsync(() => api.isleSources(isle.id), [isle.id])
  const prompt = myDataPrompt(isle, picked, fetchWhat.trim(), notes.trim(), location.origin, srcs.data)

  return (
    <Modal onClose={onClose} wide>
      <div
        className={`umd ${over ? 'over' : ''}`}
        onDragOver={(e) => { if (me && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (me && e.dataTransfer.files.length) upload(e.dataTransfer.files) }}
      >
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <h2>Same look, your data</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Bring the data you want to see in “{isle.title}”. It doesn't have to be in the right shape: your AI fits a copy of it to this isle, publishes your version and tests it until it works. Your originals stay as they are.
            </p>
          </div>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {slots.length > 0 && (
          <details className="umd-slots">
            <summary className="small">What this isle reads <span className="muted">· {slots.length} slot{slots.length === 1 ? '' : 's'}</span></summary>
            {slots.map(([name, spec]) => (
              <div key={name} className="tiny" style={{ marginTop: 6 }}>
                <code style={{ fontWeight: 700 }}>{name}</code> {spec.kind && <span className="kind">{spec.kind}</span>} <span className="muted">{spec.description}</span>
              </div>
            ))}
          </details>
        )}

        <DataSources isle={isle} compact />

        {!me ? (
          <p className="small" style={{ marginTop: 16 }}><Link to={`/login?next=${encodeURIComponent(location.pathname)}`}>Sign in</Link> to use your own data.</p>
        ) : (
          <>
            <div className="umd-grid">
              <section>
                <div className="row" style={{ marginBottom: 6 }}>
                  <b className="small grow">Your data</b>
                  {picked.length > 0 && <span className="tiny muted">{picked.length} chosen</span>}
                </div>
                {mine.loading && !all.length ? (
                  <div className="tiny muted" style={{ padding: 10 }}>Loading…</div>
                ) : (
                  <DataTree datasets={all} storageKey="pick" pick={{ chosen, setChosen: setPicked }} compact empty="Nothing yet. Drop a file, or ask your AI to fetch it." />
                )}
              </section>
              <section>
                <b className="small" style={{ display: 'block', marginBottom: 6 }}>Upload</b>
                <button className={`umd-drop ${over ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
                  <Icon name="upload" />
                  <span>{busy ? `Uploading ${busy}…` : 'Drop files here, or click to choose'}</span>
                  <span className="tiny muted">CSV, JSON, markdown, text, images. Saved to your data under uploads/.</span>
                </button>
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
                <b className="small" style={{ display: 'block', margin: '14px 0 6px' }}>Or have it fetched</b>
                <textarea className="field" rows={3} placeholder="e.g. the replies to https://x.com/someone/status/123, or Seattle's 2025 budget from data.seattle.gov" value={fetchWhat} onChange={(e) => setFetchWhat(e.target.value)} />
              </section>
            </div>
            <label className="lbl">Anything else? <span className="muted">(optional)</span></label>
            <input className="field" placeholder="e.g. use the 'posted' column as the date; only 2025" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="row umd-foot" style={{ marginTop: 14 }}>
              <span className="tiny muted grow umd-hint">
                {ready ? <>Your AI gets the steps, the isle and {picked.length ? `${picked.length} dataset${picked.length === 1 ? '' : 's'}` : 'what to fetch'}; it needs the <Link to="/connect">Prolifica connector</Link>.</> : 'Choose some data, drop a file, or say what to fetch.'}
              </span>
              <button className="btn sm" disabled={!ready} onClick={() => navigator.clipboard.writeText(prompt).then(() => toast('Prompt copied'), () => toast('Could not copy'))}>Copy prompt</button>
              <AskAiButton label="Hand to" prompt={prompt} disabled={!ready || busy > 0} onAsk={onClose} />
            </div>
          </>
        )}
        {over && <div className="umd-over"><Icon name="upload" /> Drop to upload</div>}
      </div>
    </Modal>
  )
}
