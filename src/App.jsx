import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

function AuthCard() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    const action = mode === 'signin'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })

    const { error } = await action
    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    if (mode === 'signup') {
      setMessage('Account created. Check your email if email confirmation is enabled in Supabase.')
    }
  }

  return (
    <section className="auth-card card">
      <span className="eyebrow">SUPABASE AUTH</span>
      <h2>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
      <p className="muted">Use email and password. Supabase securely manages the session.</p>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            minLength={6}
            required
          />
        </label>

        <button className="primary" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
      </form>

      {message && <p className="notice">{message}</p>}

      <button
        className="text-button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin')
          setMessage('')
        }}
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </button>
    </section>
  )
}

function Dashboard({ session }) {
  const [tasks, setTasks] = useState([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const userId = session.user.id
  const email = useMemo(() => session.user.email ?? 'Signed-in user', [session])

  async function loadTasks() {
    const { data, error: queryError } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (queryError) {
      setError(queryError.message)
    } else {
      setTasks(data ?? [])
      setError('')
    }

    setLoading(false)
  }

  useEffect(() => {
    loadTasks()

    const channel = supabase
      .channel(`tasks:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        () => loadTasks(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  async function addTask(event) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return

    const { error: insertError } = await supabase
      .from('tasks')
      .insert({ title: cleanTitle, user_id: userId })

    if (insertError) {
      setError(insertError.message)
    } else {
      setTitle('')
      await loadTasks()
    }
  }

  async function toggleTask(task) {
    const { error: updateError } = await supabase
      .from('tasks')
      .update({ done: !task.done })
      .eq('id', task.id)

    if (updateError) {
      setError(updateError.message)
    } else {
      await loadTasks()
    }
  }

  async function deleteTask(id) {
    const { error: deleteError } = await supabase
      .from('tasks')
      .delete()
      .eq('id', id)

    if (deleteError) {
      setError(deleteError.message)
    } else {
      await loadTasks()
    }
  }

  return (
    <section className="dashboard card">
      <div className="dashboard-head">
        <div>
          <span className="eyebrow">PROTECTED DASHBOARD</span>
          <h2>Your workspace</h2>
          <p className="muted">Signed in as {email}</p>
        </div>

        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>

      <form className="task-form" onSubmit={addTask}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add something to your Supabase database…"
          maxLength={120}
        />
        <button className="primary">Add</button>
      </form>

      {error && <p className="notice error">{error}</p>}

      <div className="task-list">
        {loading && <p className="muted">Loading…</p>}

        {!loading && tasks.length === 0 && (
          <div className="empty-state">
            <strong>No records yet.</strong>
            <span>Add your first task above.</span>
          </div>
        )}

        {tasks.map((task) => (
          <article className="task" key={task.id}>
            <button
              className={`check ${task.done ? 'checked' : ''}`}
              onClick={() => toggleTask(task)}
              aria-label={task.done ? 'Mark incomplete' : 'Mark complete'}
            >
              {task.done ? '✓' : ''}
            </button>

            <span className={task.done ? 'done' : ''}>{task.title}</span>

            <button className="delete" onClick={() => deleteTask(task.id)}>
              Delete
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCheckingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setCheckingSession(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  return (
    <main className="page-shell">
      <nav className="nav">
        <div className="brand-mark">S</div>
        <strong>StackStarter</strong>

        <div className="stack-pills">
          <span>Supabase</span>
          <span>GitHub</span>
          <span>Cloudflare</span>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">YOUR FIRST FULL-STACK WEBSITE</span>
          <h1>Supabase backend. GitHub code. Cloudflare frontend.</h1>
          <p>
            This starter already has user accounts, a protected database, and realtime-ready data.
          </p>

          <div className="architecture">
            <span>Browser</span>
            <b>→</b>
            <span>Cloudflare</span>
            <b>→</b>
            <span>Supabase</span>
          </div>
        </div>

        {checkingSession ? (
          <section className="card auth-card">
            <p className="muted">Checking session…</p>
          </section>
        ) : session ? (
          <Dashboard session={session} />
        ) : (
          <AuthCard />
        )}
      </section>

      <footer>
        Website code lives in GitHub. Data is protected with Supabase Row Level Security.
      </footer>
    </main>
  )
}
