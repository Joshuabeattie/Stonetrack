import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { STAGES, STAGE_LABELS } from '../../../shared/stages'
import type { JobSummary } from '../../../shared/types'
import { DueDate, PriorityTag, StageRail } from '../components/Badges'
import { Empty, ErrorNotice, Loading } from '../components/Feedback'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Layout'
import { StoneSwatch } from '../components/StoneSwatch'
import { fmtM2, plural } from '../format'
import { useApi, useDocumentTitle } from '../hooks'

const STATUS_OPTIONS = [
  { value: 'active', label: 'In the factory' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'all', label: 'All' },
]

export function JobsPage() {
  useDocumentTitle('Jobs')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'active'
  const stage = params.get('stage') ?? ''
  const due = params.get('due') ?? ''
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)

  // Filters live in the URL (?stage=cutting), so a filtered list can be bookmarked or linked to.
  const update = useCallback(
    (changes: Record<string, string>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value)
            else next.delete(key)
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Wait until typing pauses before searching.
  useEffect(() => {
    const trimmed = search.trim()
    if (trimmed === q) return
    const id = window.setTimeout(() => update({ q: trimmed }), 300)
    return () => window.clearTimeout(id)
  }, [search, q, update])

  const query = new URLSearchParams({ status, ...(stage && { stage }), ...(due && { due }), ...(q && { q }) }).toString()
  const jobs = useApi<JobSummary[]>(`/jobs?${query}`)

  return (
    <>
      <PageHeader title="Jobs" sub={jobs.data ? plural(jobs.data.length, 'job') : undefined}>
        <Link to="/jobs/new" className="button button-primary">
          <Icon name="plus" />
          New job
        </Link>
      </PageHeader>

      <div className="filters" role="search">
        <label className="filter filter-search">
          <span className="visually-hidden">Search jobs</span>
          <input type="search" placeholder="Search job number, client or drawing" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="segmented" role="radiogroup" aria-label="Show">
          {STATUS_OPTIONS.map((o) => (
            <label key={o.value} className={status === o.value ? 'is-selected' : ''}>
              <input type="radio" name="status" value={o.value} checked={status === o.value} onChange={() => update({ status: o.value === 'active' ? '' : o.value, stage: '' })} />
              {o.label}
            </label>
          ))}
        </div>
        <label className="filter">
          <span className="visually-hidden">Stage</span>
          <select value={stage} onChange={(e) => update({ stage: e.target.value })}>
            <option value="">Any stage</option>
            {STAGES.filter((s) => s !== 'dispatched').map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="visually-hidden">Due</span>
          <select value={due} onChange={(e) => update({ due: e.target.value })}>
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="this_week">Due in the next 7 days</option>
          </select>
        </label>
      </div>

      {jobs.error && <ErrorNotice error={jobs.error} onRetry={jobs.reload} />}
      {!jobs.data && jobs.loading && <Loading />}
      {jobs.data && jobs.data.length === 0 && (
        <Empty title="No jobs match these filters">
          <button
            type="button"
            className="button button-quiet"
            onClick={() => {
              setSearch('')
              setParams({}, { replace: true })
            }}
          >
            Clear filters
          </button>
        </Empty>
      )}
      {jobs.data && jobs.data.length > 0 && (
        <div className={`table-wrap ${jobs.loading ? 'is-refreshing' : ''}`}>
          <table className="table table-jobs">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">Client</th>
                <th scope="col">Stone</th>
                <th scope="col">Stage</th>
                <th scope="col">Due</th>
                <th scope="col" className="num">
                  Area
                </th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((job) => (
                <tr key={job.id} className="is-clickable" onClick={() => navigate(`/jobs/${job.id}`)}>
                  <td data-label="Job">
                    <Link to={`/jobs/${job.id}`} className="job-number" onClick={(e) => e.stopPropagation()}>
                      {job.jobNumber}
                    </Link>
                    <PriorityTag priority={job.priority} />
                    {job.remakeCount > 0 && <span className="tag">{plural(job.remakeCount, 'remake')}</span>}
                  </td>
                  <td data-label="Client">{job.clientName}</td>
                  <td data-label="Stone">
                    <span className="stone-chip">
                      <StoneSwatch hex={job.swatchHex} type={job.materialType} seed={job.materialCode} />
                      {job.materialName}
                    </span>
                  </td>
                  <td data-label="Stage">
                    <StageRail stage={job.stage} />
                  </td>
                  <td data-label="Due">
                    <DueDate date={job.dueDate} done={job.stage === 'dispatched'} />
                  </td>
                  <td data-label="Area" className="num">
                    {fmtM2(job.areaM2)}
                    <span className="cell-sub">{plural(job.partCount, 'part')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
