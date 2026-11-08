// One interactive authentication, two sequential Simplix ERP syncs.
// Credentials are inherited by child processes only; no token or password files.
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'

const flag = name => process.argv.includes('--' + name)
const arg = (name, fallback) => {
  const value = process.argv.find(value => value.startsWith('--' + name + '='))
  return value ? value.slice(name.length + 3) : fallback
}

function prompt(message, hidden = false) {
  if (!process.stdin.isTTY) throw new Error('Run this daily sync from an interactive CMD window.')
  if (!hidden || !process.stdin.setRawMode) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise(resolve => rl.question(message, value => { rl.close(); resolve(value.trim()) }))
  }
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(message)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onKey)
    }
    const onKey = char => {
      if (char === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Cancelled')); return }
      if (char === '\r' || char === '\n') { cleanup(); process.stdout.write('\n'); resolve(value.trim()); return }
      if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); return }
      value += char
    }
    process.stdin.on('data', onKey)
  })
}

async function main() {
  const year = Number(arg('year', String(new Date().getFullYear())))
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('Invalid --year.')
  const refreshAllDetails = flag('refresh-all-details')
  const refreshAllLines = flag('refresh-all-lines')
  const lineRecentDays = Number(arg('line-recent-days', '120'))
  const lineStaleHours = Number(arg('line-stale-hours', '20'))
  if (!Number.isFinite(lineRecentDays) || lineRecentDays < 0 || lineRecentDays > 3650) throw new Error('Invalid --line-recent-days.')
  if (!Number.isFinite(lineStaleHours) || lineStaleHours < 0 || lineStaleHours > 87600) throw new Error('Invalid --line-stale-hours.')

  console.log('\nSRD Warehouse System — Daily Simplix Sync')
  console.log('Stage 1: PR headers, approvals, RFQs, POs and receipt events')
  console.log('Stage 2: PR item lines and requested quantities/prices')
  console.log('Year: ' + year + (refreshAllDetails ? ' · FULL historical detail refresh' : ' · incremental detail refresh'))
  console.log('Credentials are not written to disk.\n')

  let bearer = process.env.SIMPLIX_BEARER_TOKEN || await prompt('Production Simplix bearer token (hidden): ', true)
  const email = process.env.SRD_PORTAL_EMAIL || await prompt('SRD portal email: ')
  const password = process.env.SRD_PORTAL_PASSWORD || await prompt('SRD portal password (hidden): ', true)
  if (!bearer || !email || !password) throw new Error('Simplix token and SRD portal credentials are required.')

  const projectRoot = path.resolve(import.meta.dirname, '..')
  async function stage(name, script, args) {
    console.log('\n===================================================')
    console.log(name)
    console.log('===================================================\n')
    const env = { ...process.env, SIMPLIX_BEARER_TOKEN: bearer, SRD_PORTAL_EMAIL: email, SRD_PORTAL_PASSWORD: password }
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', script), ...args], {
        cwd: projectRoot,
        env,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        windowsHide: false,
      })
      child.on('message', message => {
        if (message && message.type === 'simplix-token-refreshed' && typeof message.token === 'string' && message.token.trim()) {
          bearer = message.token.trim()
          console.log('Updated Simplix authentication shared securely with the next sync stage.')
        }
      })
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code === 0 && !signal ? 0 : 1))
    })
    return code
  }

  const detailArgs = ['--year=' + year]
  if (refreshAllDetails) detailArgs.push('--refresh-all-details')
  const detailsCode = await stage('STAGE 1/2 — SIMPLIX PR DETAILS', 'sync-simplix-prs.mjs', detailArgs)
  if (detailsCode !== 0) {
    console.error('\nPR details stage failed. PR items stage was NOT started, so the earlier failure stays visible.')
    process.exitCode = 1
    return
  }

  const lineArgs = ['--year=' + year, '--limit=5000']
  if (refreshAllLines) lineArgs.push('--refresh-all')
  else lineArgs.push('--refresh-recent-days=' + lineRecentDays, '--stale-hours=' + lineStaleHours)
  const linesCode = await stage('STAGE 2/2 — SIMPLIX PR ITEM LINES', 'sync-simplix-pr-lines.mjs', lineArgs)
  if (linesCode !== 0) {
    console.error('\nPR details completed, but PR item-line sync reported failures. Re-run later to retry.')
    process.exitCode = 1
    return
  }
  console.log('\nBOTH DAILY SIMPLIX SYNCS COMPLETED SUCCESSFULLY.')
  console.log('No Excel uploads or procurement receipt quantities were modified by these processes.')
}

main().catch(error => {
  console.error('\nDaily Simplix sync failed: ' + (error?.message || error))
  process.exitCode = 1
})
