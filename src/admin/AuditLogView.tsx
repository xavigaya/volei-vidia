// Registre d'accions: consulta amb filtres, detall dels canvis i exportació
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { downloadXlsx } from '../lib/excel';
import { ErrorBox, EmptyState, Spinner } from '../components/ui';

export interface AuditEntry {
  id: number;
  at: string;
  user_id: string | null;
  user_email: string | null;
  club_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string | null;
  changes: Record<string, unknown> | null;
}

const ENTITIES = [
  'clubs',
  'club_members',
  'club_invitations',
  'profiles',
  'seasons',
  'teams',
  'players',
  'team_players',
  'matches',
  'match_players',
  'match_events',
  'match',
  'players',
  'file',
  'video',
  'session',
];
const ACTIONS = ['insert', 'update', 'delete', 'set_start', 'lineup_fix', 'undo', 'login', 'export', 'import', 'upload'];
const PAGE = 100;

interface Filters {
  from: string;
  to: string;
  club: string;
  user: string;
  entity: string;
  action: string;
  text: string;
}

const EMPTY: Filters = { from: '', to: '', club: '', user: '', entity: '', action: '', text: '' };

function short(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

// Taula de canvis: per a una modificació, camp → abans / després; si no, camp → valor
function ChangesTable({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation();
  const c = entry.changes ?? {};
  const keys = Object.keys(c).filter((k) => k !== 'id' && k !== 'club_id');
  if (keys.length === 0) return <span className="muted small">—</span>;
  const isDiff = entry.action === 'update';
  return (
    <table className="table changes-table">
      <thead>
        <tr>
          <th>{t('audit.field')}</th>
          {isDiff ? (
            <>
              <th>{t('audit.before')}</th>
              <th>{t('audit.after')}</th>
            </>
          ) : (
            <th>{t('audit.value')}</th>
          )}
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const v = c[k];
          return (
            <tr key={k}>
              <td className="mono small">{k}</td>
              {isDiff && Array.isArray(v) ? (
                <>
                  <td className="small">{short(v[0])}</td>
                  <td className="small">{short(v[1])}</td>
                </>
              ) : (
                <td className="small">{short(v)}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function AuditLogView() {
  const { t, i18n } = useTranslation();
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from('clubs')
      .select('id, name')
      .order('name')
      .then(({ data }) => setClubs((data ?? []) as { id: string; name: string }[]));
  }, []);

  const query = useCallback((f: Filters) => {
    let q = supabase.from('audit_log').select('*');
    if (f.from) q = q.gte('at', new Date(`${f.from}T00:00:00`).toISOString());
    if (f.to) q = q.lt('at', new Date(new Date(`${f.to}T00:00:00`).getTime() + 86400000).toISOString());
    if (f.club) q = q.eq('club_id', f.club);
    if (f.user.trim()) q = q.ilike('user_email', `%${f.user.trim()}%`);
    if (f.entity) q = q.eq('entity', f.entity);
    if (f.action) q = q.eq('action', f.action);
    if (f.text.trim()) q = q.ilike('summary', `%${f.text.trim()}%`);
    return q.order('at', { ascending: false }).order('id', { ascending: false });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await query(applied).range(page * PAGE, page * PAGE + PAGE);
    if (error) setError(error.message);
    else {
      const list = (data ?? []) as AuditEntry[];
      setHasMore(list.length > PAGE);
      setRows(list.slice(0, PAGE));
    }
    setLoading(false);
  }, [applied, page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const clubName = (id: string | null) => (id ? clubs.find((c) => c.id === id)?.name ?? '—' : '');
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  const entityLabel = (e: string) => t(`audit.entity_${e}`, { defaultValue: e });
  const actionLabel = (a: string) => t(`audit.action_${a}`, { defaultValue: a });
  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));

  async function onExport() {
    setError(null);
    const all: AuditEntry[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await query(applied).range(from, from + 999);
      if (error) {
        setError(error.message);
        return;
      }
      all.push(...((data ?? []) as AuditEntry[]));
      if (!data || data.length < 1000) break;
    }
    await downloadXlsx(`registre_${new Date().toISOString().slice(0, 10)}`, [
      {
        name: t('audit.title'),
        widths: [20, 28, 22, 14, 18, 40, 70],
        rows: [
          [t('audit.when'), t('audit.user'), t('admin.club'), t('audit.action'), t('audit.entity'), t('audit.summary'), t('audit.changes')],
          ...all.map((r) => [
            fmt.format(new Date(r.at)),
            r.user_email ?? '',
            clubName(r.club_id),
            actionLabel(r.action),
            entityLabel(r.entity),
            r.summary ?? '',
            r.changes ? JSON.stringify(r.changes) : '',
          ]),
        ],
      },
    ]);
  }

  async function onPurge() {
    const { data, error } = await supabase.rpc('admin_purge_audit');
    if (error) setError(error.message);
    else {
      setInfo(t('audit.purged', { n: Number(data ?? 0) }));
      await load();
    }
  }

  return (
    <section className="card stack">
      <div className="row between wrap">
        <h2>{t('audit.title')}</h2>
        <div className="row wrap">
          <button className="btn btn-sm" onClick={() => void onExport()}>
            ⤒ Excel
          </button>
          <button className="btn btn-sm" onClick={() => void onPurge()} title={t('audit.purgeHelp')}>
            {t('audit.purge')}
          </button>
        </div>
      </div>
      <p className="small muted">{t('audit.help')}</p>

      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setApplied(filters);
        }}
      >
        <label className="field">
          <span>{t('audit.from')}</span>
          <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('audit.to')}</span>
          <input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('admin.club')}</span>
          <select value={filters.club} onChange={(e) => set('club', e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('audit.user')}</span>
          <input value={filters.user} onChange={(e) => set('user', e.target.value)} placeholder="@" />
        </label>
        <label className="field">
          <span>{t('audit.entity')}</span>
          <select value={filters.entity} onChange={(e) => set('entity', e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e}>
                {entityLabel(e)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('audit.action')}</span>
          <select value={filters.action} onChange={(e) => set('action', e.target.value)}>
            <option value="">{t('audit.all')}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('audit.summary')}</span>
          <input value={filters.text} onChange={(e) => set('text', e.target.value)} />
        </label>
        <div className="row align-end">
          <button className="btn btn-primary">{t('audit.apply')}</button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFilters(EMPTY);
              setApplied(EMPTY);
              setPage(0);
            }}
          >
            {t('audit.clear')}
          </button>
        </div>
      </form>

      {error && <ErrorBox message={error} />}
      {info && <div className="notice small">{info}</div>}
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="table-scroll">
          <table className="table audit-table">
            <thead>
              <tr>
                <th>{t('audit.when')}</th>
                <th>{t('audit.user')}</th>
                <th>{t('admin.club')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('audit.entity')}</th>
                <th>{t('audit.summary')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="nowrap small">{fmt.format(new Date(r.at))}</td>
                    <td className="small">{r.user_email ?? '—'}</td>
                    <td className="small">{clubName(r.club_id)}</td>
                    <td>
                      <span className={`badge audit-${r.action}`}>{actionLabel(r.action)}</span>
                    </td>
                    <td className="small">{entityLabel(r.entity)}</td>
                    <td>{r.summary ?? ''}</td>
                  </tr>
                  {open === r.id && (
                    <tr className="detail-row">
                      <td colSpan={6}>
                        <ChangesTable entry={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row between">
        <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← {t('audit.newer')}
        </button>
        <span className="small muted">{t('audit.pageN', { n: page + 1 })}</span>
        <button className="btn btn-sm" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
          {t('audit.older')} →
        </button>
      </div>
    </section>
  );
}
