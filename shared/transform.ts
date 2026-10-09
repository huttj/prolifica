import jsonata from 'jsonata'
import { EditError } from './edits'

/**
 * Transforming data with JSONata (jsonata.org): a query and transformation language for JSON, run by an
 * interpreter (no eval), so a Worker can run an agent's expression over a dataset and save the result
 * without the rows passing through the agent. The expression is kept as the result's transform, so how
 * it was made can be read and re-run.
 *
 * Bounded three ways: evaluation steps (Workers' clocks don't move during pure computation, so jsonata's
 * own timeout can't fire there; counting steps works everywhere), stack depth and sequence length.
 */

export const LIMITS = { steps: 20_000_000, stack: 400, sequence: 2_000_000 }

export async function runExpression(expression: string, input: unknown, vars: Record<string, unknown> = {}, limits = LIMITS): Promise<unknown> {
  let steps = 0
  // jsonata reads options.timeout at every step of evaluation: count those reads
  const options = {
    get timeout() {
      if (++steps > limits.steps) throw { code: 'STEPS', message: `The expression took more than ${limits.steps.toLocaleString()} steps; narrow it (filter before mapping, avoid nested loops over big arrays)` }
      return Number.MAX_SAFE_INTEGER
    },
    stack: limits.stack,
    sequence: limits.sequence,
  }
  let compiled: ReturnType<typeof jsonata>
  try {
    compiled = jsonata(expression, options as never)
  } catch (e) {
    throw new EditError(describe(e, expression))
  }
  try {
    const out = await compiled.evaluate(input, vars)
    if (out === undefined) throw new EditError('The expression matched nothing (check the field names with read_data shape: true)')
    return clean(out)
  } catch (e) {
    if (e instanceof EditError) throw e
    throw new EditError(describe(e, expression))
  }
}

function describe(e: unknown, expression: string): string {
  const err = e as { code?: string; message?: string; position?: number; token?: string }
  const where = typeof err.position === 'number' ? ` (at character ${err.position}: …${expression.slice(Math.max(0, err.position - 20), err.position + 10)}…)` : ''
  return `JSONata${err.code ? ' ' + err.code : ''}: ${err.message ?? String(e)}${where}`
}

/** jsonata marks its results (sequence flags, functions); keep plain JSON. */
function clean(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'function' ? undefined : x)) ?? 'null')
}
