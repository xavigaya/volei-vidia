import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ErrorBox, Modal, Spinner } from '../components/ui';
import { Menu } from '../components/Menu';
import { MatchInfoForm } from './MatchInfoForm';
import { exportMatchGeneralPdf, exportMatchReportPdf } from '../reports/exportReports';
import { useMatch } from './useMatch';
import { useClub } from '../club/ClubProvider';
import { LiveScoring } from './LiveScoring';
import { RosterEditor } from './RosterEditor';
import { MatchStatsView } from '../stats/MatchStatsView';
import { filterToParam } from '../video/clips';
import { downloadMatchDvw } from '../dvw/exportMatch';
import { exportMatchExcel } from '../stats/matchExcel';

type Tab = 'live' | 'roster' | 'stats';

export function MatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const m = useMatch(matchId!);
  const { canEdit, club } = useClub();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = tabParam === 'roster' || tabParam === 'stats' ? tabParam : 'live';
  const [editing, setEditing] = useState(false);

  if (m.loading) return <Spinner />;
  if (!m.match || !m.state) return <ErrorBox message={m.error ?? '404'} />;
  const match = m.match;

  async function onDelete() {
    if (!window.confirm(t('common.confirmDelete'))) return;
    const { error } = await supabase.from('matches').delete().eq('id', match.id);
    if (error) m.setError(error.message);
    else navigate('/matches');
  }

  const date = match.played_at
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(match.played_at))
    : null;

  return (
    <div className="page page-wide">
      <Link to="/matches" className="back-link">
        ← {t('matches.title')}
      </Link>
      <header className="match-header">
        <div>
          <h1>
            {match.home.name} <span className="muted">–</span> {match.away.name}
          </h1>
          <div className="muted small">
            {[date, match.competition, match.phase, match.venue, match.city].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="row wrap">
          {!m.canCode && (
            <span className="badge">{match.coder_id ? t('matches.readOnly') : t('matches.noCoder')}</span>
          )}
          {canEdit && !m.canCode && !match.coder_id && (
            <button className="btn btn-sm" onClick={() => void m.claim()}>
              {t('matches.claim')}
            </button>
          )}
          {m.canCode && !m.isCoder && (
            <button className="btn btn-sm" onClick={() => void m.claim()} title={t('matches.takeOverHelp')}>
              {t('matches.takeOver')}
            </button>
          )}
          {m.canCode && (
            <button className="btn btn-sm" onClick={() => setEditing(true)}>
              {t('matchInfo.edit')}
            </button>
          )}
          <Menu
            label={`⤒ ${t('report.pdf')}`}
            disabled={m.events.length === 0}
            items={[
              { label: t('report.matchReport'), onSelect: () => void exportMatchReportPdf(m, t, club?.primary_color).catch((e: Error) => m.setError(e.message)) },
              { label: t('report.general'), onSelect: () => void exportMatchGeneralPdf(m, t).catch((e: Error) => m.setError(e.message)) },
            ]}
          />
          <button className="btn btn-sm" onClick={() => void downloadMatchDvw(m).catch((e: Error) => m.setError(e.message))} disabled={m.events.length === 0} title={t('dvw.exportHelp')}>
            ⤒ DataVolley
          </button>
          <button
            className="btn btn-sm"
            onClick={() => void exportMatchExcel(m, t).catch((e: Error) => m.setError(e.message))}
            disabled={m.events.length === 0}
          >
            ⤒ Excel
          </button>
          {m.canCode && (
            <button className="btn btn-sm btn-danger" onClick={() => void onDelete()}>
              {t('common.delete')}
            </button>
          )}
        </div>
      </header>

      <div className="segmented tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'on' : ''} onClick={() => setParams({})}>
          {t('matches.tabLive')}
        </button>
        <button role="tab" aria-selected={tab === 'stats'} className={tab === 'stats' ? 'on' : ''} onClick={() => setParams({ tab: 'stats' })}>
          {t('matches.tabStats')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'roster'}
          className={tab === 'roster' ? 'on' : ''}
          onClick={() => setParams({ tab: 'roster' })}
        >
          {t('matches.tabRoster')} <span className="muted">({m.players.length})</span>
        </button>
      </div>

      <Modal title={t('matchInfo.title')} open={editing} onClose={() => setEditing(false)}>
        {editing && <MatchInfoForm m={m} onDone={() => setEditing(false)} />}
      </Modal>

      {m.fromCache && <div className="notice small">{t('offline.cachedData')}</div>}
      {m.error && <ErrorBox message={m.error} />}
      {/* La pantalla de codificació es manté muntada (amagada) en canviar de
          pestanya perquè el vídeo no es reiniciï */}
      {m.players.length === 0 && m.events.length === 0 ? (
        tab === 'live' && (
          <div className="card stack">
            <p>{t('matches.needRoster')}</p>
            <button className="btn btn-primary" onClick={() => setParams({ tab: 'roster' })}>
              {t('matches.tabRoster')}
            </button>
          </div>
        )
      ) : (
        <div hidden={tab !== 'live'}>
          <LiveScoring m={m} clipFilter={params.get('clip')} active={tab === 'live'} />
        </div>
      )}
      {tab === 'stats' && <MatchStatsView m={m} onShowClips={(f) => setParams({ clip: filterToParam(f) })} />}
      {tab === 'roster' && <RosterEditor m={m} />}
    </div>
  );
}
