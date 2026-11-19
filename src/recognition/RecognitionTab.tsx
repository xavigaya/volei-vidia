import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { saveFile } from '../lib/download';
import { buildAnalysisPackage } from './analysisPackage';
import type { Calibration } from './calibration';
import { jsonBlob, slug } from './exchange';
import { useTranslation } from 'react-i18next';
import { ErrorBox, Spinner } from '../components/ui';
import { useClub } from '../club/ClubProvider';
import type { UseMatch } from '../matches/useMatch';
import { ReceptionPanel } from './ReceptionPanel';
import { CalibrationPanel } from './CalibrationPanel';
import { ReviewPanel } from './ReviewPanel';
import { ScoresheetPanel } from './ScoresheetPanel';
import { SystemsPanel } from './SystemsPanel';
import { useRecognition } from './useRecognition';

type Section = 'systems' | 'reception' | 'sheet' | 'calibration' | 'review';

// Pestanya "Anàlisi assistida" del partit (reconeixement de jugades, fase 0.1):
// dades prèvies per a l'anàlisi i verificació amb l'acta oficial.
export function RecognitionTab({ m }: { m: UseMatch }) {
  const { t } = useTranslation();
  const { canEdit } = useClub();
  const r = useRecognition(m);
  const [section, setSection] = useState<Section>('systems');
  const [pkgMsg, setPkgMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Paquet d'anàlisi per a l'eina local vidia-vision
  async function exportPackage() {
    const match = m.match!;
    const { data, error } = await supabase.from('video_calibrations').select('from_time, data').eq('match_id', match.id).order('from_time');
    const calibrations: Calibration[] = error
      ? []
      : ((data ?? []) as { from_time: number; data: Omit<Calibration, 'fromTime'> }[]).map((row) => ({ ...row.data, fromTime: row.from_time }));
    const sides = ['H', 'A'] as const;
    const pkg = buildAnalysisPackage({
      match,
      state: m.state!,
      players: m.players,
      events: m.events,
      calibrations,
      systems: r.setSystemsList.map((x) => ({ set: x.set, side: x.side, system: x.current })),
      receptions: sides.flatMap((side) => {
        const sys = r.setSystemsList.find((x) => x.side === side && x.set === 1)?.current;
        const hasLibero = m.players.some((p) => p.side === side && p.is_libero);
        return sys ? [{ side, reception: r.receptionFor(side, sys.code, hasLibero) }] : [];
      }),
      scoresheet: r.scoresheet,
    });
    const date = match.played_at ? match.played_at.slice(0, 10) : null;
    try {
      await saveFile(`${slug('paquet', match.home.name, match.away.name, date)}.json`, jsonBlob(pkg));
      setPkgMsg(
        calibrations.length
          ? { ok: true, text: t('recognition.package.done') }
          : { ok: false, text: t('recognition.package.noCalibration') },
      );
    } catch (e) {
      setPkgMsg({ ok: false, text: (e as Error).message });
    }
  }

  if (r.loading) return <Spinner />;
  if (r.missingMigration) return <div className="notice">{t('recognition.missingMigration')}</div>;

  return (
    <div className="stack rec-tab">
      {r.error && <ErrorBox message={r.error} />}
      <div className="segmented" role="tablist">
        {(['systems', 'reception', 'sheet', 'calibration', 'review'] as Section[]).map((s) => (
          <button key={s} role="tab" aria-selected={section === s} className={section === s ? 'on' : ''} onClick={() => setSection(s)}>
            {t(`recognition.sections.${s}`)}
          </button>
        ))}
      </div>
      {section === 'systems' && <SystemsPanel m={m} r={r} canEdit={m.canCode} />}
      {section === 'reception' && <ReceptionPanel m={m} r={r} canEdit={canEdit} />}
      {section === 'sheet' && <ScoresheetPanel m={m} r={r} canEdit={m.canCode} />}
      {section === 'calibration' && <CalibrationPanel m={m} canEdit={m.canCode} />}
      {section === 'review' && <ReviewPanel m={m} r={r} canEdit={m.canCode} />}
      <div className="card row wrap rec-package">
        <button className="btn" onClick={() => void exportPackage()} title={t('recognition.package.help')}>
          {t('recognition.package.export')}
        </button>
        <span className="small muted">{t('recognition.package.help')}</span>
        {pkgMsg && <span className={pkgMsg.ok ? 'ok' : 'warn-text'}>{pkgMsg.text}</span>}
      </div>
    </div>
  );
}
