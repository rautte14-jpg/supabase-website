const money = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const mvr = (n) => 'MVR ' + money(n)

export default function AgeingTrend({ snapshots }) {
  if (!snapshots.length) return null

  const current = snapshots.at(-1) || null
  const previous = snapshots.at(-2) || null
  if (!current) return null

  const currentDate = new Date(current.snapshot_date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const previousDate = previous
    ? new Date(previous.snapshot_date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Previous week'

  const buckets = [
    { key: 'p2', label: 'P2 — 1–3 Years' },
    { key: 'p3', label: 'P3 — 3–4 Years' },
    { key: 'p4', label: 'P4 — 4–5 Years' },
    { key: 'p5', label: 'P5 — Over 5 Years' },
  ]

  const rows = buckets.map((bucket) => {
    const currentValue = Number(current.metrics?.[bucket.key] || 0)
    const previousValue = Number(previous?.metrics?.[bucket.key] || 0)
    return {
      ...bucket,
      currentValue,
      previousValue,
      change: previous ? currentValue - previousValue : null,
    }
  })

  const biggestMovement = previous
    ? [...rows].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
    : null
  const improvedBuckets = rows.filter((row) => row.change !== null && row.change < 0)

  const currentOnHand = Number(current.metrics?.onHandValue || 0)
  const previousOnHand = Number(previous?.metrics?.onHandValue || 0)
  const onHandChange = previous ? currentOnHand - previousOnHand : null

  const currentOver1 = Number(current.metrics?.over1 || 0)
  const previousOver1 = Number(previous?.metrics?.over1 || 0)
  const over1Change = previous ? currentOver1 - previousOver1 : null

  return (
    <>
      <section className="panel ageing-movement-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">WEEK-TO-WEEK AGEING</span>
            <h3>Ageing Movement by Bucket</h3>
            <p>Last week compared with the current ageing report.</p>
          </div>
          <span>{previous ? previousDate + ' → ' + currentDate : currentDate}</span>
        </div>

        <div className="ageing-movement-table">
          <div className="ageing-movement-row ageing-movement-head">
            <span>Ageing bucket</span>
            <span>Last week</span>
            <span>This week</span>
            <span>Change</span>
          </div>
          {rows.map((row) => (
            <div className="ageing-movement-row" key={row.key}>
              <strong>{row.label}</strong>
              <span>{previous ? mvr(row.previousValue) : '—'}</span>
              <span>{mvr(row.currentValue)}</span>
              <b className={row.change === null ? '' : row.change > 0 ? 'increase' : row.change < 0 ? 'decrease' : ''}>
                {row.change === null ? '—' : ((row.change > 0 ? '+' : '') + mvr(row.change))}
              </b>
            </div>
          ))}
        </div>
      </section>

      {previous && (
        <section className="ageing-takeaway">
          <div>
            <span className="eyebrow">KEY TAKEAWAY</span>
            <h3>What changed this week?</h3>
          </div>
          <div className="ageing-takeaway-points">
            <p>
              Total on-hand value <b>{onHandChange >= 0 ? 'increased' : 'decreased'} by {mvr(Math.abs(onHandChange))}</b>,
              from {mvr(previousOnHand)} to {mvr(currentOnHand)}.
            </p>
            <p>
              Stock aged over 1 year <b>{over1Change >= 0 ? 'increased' : 'decreased'} by {mvr(Math.abs(over1Change))}</b>,
              from {mvr(previousOver1)} to {mvr(currentOver1)}.
            </p>
            {biggestMovement && (
              <p>
                The largest ageing-bucket movement was <b>{biggestMovement.label}</b> at
                <b> {biggestMovement.change >= 0 ? '+' : '−'}{mvr(Math.abs(biggestMovement.change))}</b>.
              </p>
            )}
            {improvedBuckets.length > 0 && (
              <p>
                Bucket{improvedBuckets.length > 1 ? 's' : ''} showing a reduction:
                <b> {improvedBuckets.map((row) => row.label.split(' — ')[0]).join(', ')}</b>.
              </p>
            )}
          </div>
        </section>
      )}
    </>
  )
}
