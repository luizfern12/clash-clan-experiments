import { useState } from 'react'
import './App.css'

function fmt(v) {
  return v === null || v === undefined ? '-' : v
}

function useClanFetch(path) {
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    const clanTag = tag.trim().replace(/^#/, '')
    if (!clanTag) return
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch(`/api/clan/${encodeURIComponent(clanTag)}${path}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Erro HTTP ${res.status}`)
      setData(json)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return { tag, setTag, loading, data, error, submit }
}

function SearchForm({ tag, setTag, loading, submit }) {
  return (
    <form onSubmit={submit} className="search">
      <input
        value={tag}
        onChange={(e) => setTag(e.target.value)}
        placeholder="Tag do clã (ex.: #LLJ8JQ99)"
        autoFocus
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Carregando…' : 'Analisar'}
      </button>
    </form>
  )
}

function ReportTab() {
  const { tag, setTag, loading, data, error, submit } = useClanFetch('')

  return (
    <>
      <SearchForm tag={tag} setTag={setTag} loading={loading} submit={submit} />

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <div className="warnings">
            {data.warnings.length === 0 ? (
              <p>Nenhum aviso de promoção.</p>
            ) : (
              data.warnings.map((w) => (
                <p key={w.tag} className="warning">
                  ⚠ {w.name} ({w.roleLabel}) → {w.promotion.label}{' '}
                  <span className="reason">({w.promotion.reason})</span>
                </p>
              ))
            )}
          </div>

          <table>
            <thead>
              <tr>
                <th>Jogador</th>
                <th>Cargo</th>
                <th>Média 4</th>
                <th>Média 8</th>
                <th>Part. 4/8</th>
                <th>Promoção</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.tag} className={m.promotion ? 'promoted' : ''}>
                  <td>{m.name}</td>
                  <td>{m.roleLabel}</td>
                  <td>{fmt(m.media4)}</td>
                  <td>{fmt(m.media8)}</td>
                  <td>
                    {fmt(m.part4)}/{fmt(m.part8)}
                  </td>
                  <td>{m.promotion ? m.promotion.label : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

function WarAttacksTab() {
  const { tag, setTag, loading, data, error, submit } = useClanFetch('/war-attacks')
  const max = data ? Math.max(...data.weeks.map((w) => w.attacks), 1) : 1

  return (
    <>
      <SearchForm tag={tag} setTag={setTag} loading={loading} submit={submit} />

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <p className="summary">
            <strong>{data.clan.name}</strong> ({data.clan.tag}) —{' '}
            {data.players} jogadores
          </p>

          <div className="chart">
            {data.weeks.map((w) => (
              <div key={w.label} className="bar-group">
                <div className="bar-value">
                  {w.attacks}
                  {w.current && (
                    <span className="today">({w.attacksToday} hoje)</span>
                  )}
                </div>
                <div
                  className={`bar${w.current ? ' current' : ''}`}
                  style={{ height: `${Math.round((w.attacks / max) * 100)}%` }}
                  title={w.label}
                ></div>
                <div className="bar-label">{w.label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function App() {
  const [tab, setTab] = useState('report')

  return (
    <div className="container">
      <nav className="navbar">
        <span className="brand">Clash Royale — Gestão de Clã</span>
        <div className="tabs">
          <button
            className={tab === 'report' ? 'active' : ''}
            onClick={() => setTab('report')}
          >
            Relatório
          </button>
          <button
            className={tab === 'attacks' ? 'active' : ''}
            onClick={() => setTab('attacks')}
          >
            Ataques de Guerra
          </button>
        </div>
      </nav>

      {tab === 'report' ? <ReportTab /> : <WarAttacksTab />}
    </div>
  )
}

export default App
