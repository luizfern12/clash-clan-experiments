import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore'
import { db } from './firebase'
import './App.css'

function fmt(v) {
  return v === null || v === undefined ? '-' : v
}

const THEMES = ['auto', 'light', 'dark']

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'auto'
    } catch {
      return 'auto'
    }
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const effective = theme === 'auto' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = effective
    }
    apply()
    if (theme === 'auto') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  const set = (next) => {
    setTheme(next)
    try {
      localStorage.setItem('theme', next)
    } catch {}
  }

  return { theme, set }
}

function useClans() {
  const [clans, setClans] = useState([])
  const [error, setError] = useState(null)
  useEffect(() => {
    const q = query(collection(db, 'clans'), where('enabled', '==', true))
    return onSnapshot(
      q,
      (snap) => setClans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setError(err.message),
    )
  }, [])
  return { clans, error }
}

function useReport(clanId) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!clanId) {
      setReport(null)
      return
    }
    setLoading(true)
    setError(null)
    return onSnapshot(
      doc(db, 'clans', clanId, 'report', 'latest'),
      (snap) => {
        setReport(snap.exists() ? snap.data() : null)
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
    )
  }, [clanId])
  return { report, loading, error }
}

function ReportTab({ report }) {
  const { promotion } = report
  return (
    <>
      <div className="warnings">
        {!promotion.warnings.length ? (
          <p>Nenhum aviso de promoção.</p>
        ) : (
          promotion.warnings.map((w) => (
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
          {promotion.members.map((m) => (
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
  )
}

function WarAttacksTab({ report }) {
  const wa = report.warAttacks
  const daily = wa?.daily || { dates: [], players: {} }
  const dates = daily.dates || []
  const labels = daily.labels || {}
  const [sort, setSort] = useState('default')
  const max = Math.max(...(wa?.weeks || []).map((w) => w.attacks), 1)

  const totalOf = ([, p]) => dates.reduce((a, d) => a + (p.days?.[d] || 0), 0)
  const players = Object.entries(daily.players || {})
  if (sort !== 'default') {
    const dir = sort === 'desc' ? -1 : 1
    players.sort((a, b) => (totalOf(b) - totalOf(a)) * dir || a[0].localeCompare(b[0]))
  }

  return (
    <>
      <p className="summary">
        Últimas 7 semanas + semana atual — ataques diários por jogador
      </p>

      <div className="chart">
        {(wa?.weeks || []).map((w) => (
          <div key={w.label} className="bar-group">
            <div className="bar-value">
              {w.attacks}
              {w.current && <span className="today">({w.attacksToday} hoje)</span>}
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

      {dates.length === 0 ? (
        <p className="muted">Ainda sem dados diários — a coleta começou a rodar agora.</p>
      ) : (
        <>
          <div className="sort-row">
            <label htmlFor="daily-sort">Ordenar por ataques:</label>
            <select
              id="daily-sort"
              className="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="default">Ordem padrão</option>
              <option value="desc">Mais → Menos</option>
              <option value="asc">Menos → Mais</option>
            </select>
          </div>
          <div className="table-scroll">
            <table className="daily">
              <thead>
                <tr>
                  <th>Jogador</th>
                  {dates.map((d) => (
                    <th key={d} title={d}>
                      {labels[d] || d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map(([tag, p]) => (
                  <tr key={tag}>
                    <td>{p.name}</td>
                    {dates.map((d) => (
                      <td key={d}>{fmt(p.days?.[d])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function App() {
  const [tab, setTab] = useState('report')
  const { clans, error: clansError } = useClans()
  const [clanId, setClanId] = useState('')
  const { report, loading, error } = useReport(clanId)
  const { theme, set } = useTheme()

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <div className="navbar-left">
            <span className="brand">ClashClanSpy</span>
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
          </div>
          <div className="navbar-right">
            <select
              className="clan-select"
              value={clanId}
              onChange={(e) => setClanId(e.target.value)}
            >
              <option value="">Selecione um clã…</option>
              {clans.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (#{c.id})
                </option>
              ))}
            </select>
            <select
              className="theme-select"
              value={theme}
              onChange={(e) => set(e.target.value)}
              title="Tema: Auto segue o sistema"
            >
              <option value="auto">Auto</option>
              <option value="light">Claro</option>
              <option value="dark">Escuro</option>
            </select>
          </div>
        </div>
      </nav>
      <div className="container">

      {clansError && <p className="error">{clansError}</p>}
      {!clanId && <p className="muted">Escolha um clã acima.</p>}
      {clanId && loading && <p className="muted">Carregando…</p>}
      {clanId && error && <p className="error">{error}</p>}
      {clanId && !loading && !report && !error && (
        <p className="muted">Ainda não há dados para este clã (aguarde a primeira coleta).</p>
      )}
      {clanId && report && (
        <>
          <p className="summary">
            <strong>{report.clan.name}</strong> (#{report.clan.tag.replace('#', '')}) —{' '}
            atualizado {new Date(report.updatedAt).toLocaleString()}
          </p>
          {tab === 'report' ? <ReportTab report={report} /> : <WarAttacksTab report={report} />}
        </>
      )}
    </div>
    </>
  )
}

export default App
