import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase, publicLogoUrl, LOGO_BUCKET } from '../lib/supabase';
import { useClub, useCurrentClub } from './ClubProvider';
import { LANGUAGES } from '../i18n';
import { ErrorBox, PageHeader } from '../components/ui';
import { applyClubTheme } from './theme';
import { parsePlaylistId } from '../video/youtubeUpload';
import type { Club } from '../lib/types';

export function ClubSettingsPage() {
  const { t } = useTranslation();
  const club = useCurrentClub();
  const { isAdmin, refresh, selectClub } = useClub();
  const [form, setForm] = useState<Club>(club);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setForm(club), [club]);

  // Vista prèvia en directe dels colors
  useEffect(() => {
    applyClubTheme(form);
  }, [form]);
  useEffect(() => () => applyClubTheme(club), [club]);

  function set<K extends keyof Club>(key: K, value: Club[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('clubs')
      .update({
        name: form.name.trim(),
        short_name: form.short_name?.trim() || null,
        primary_color: form.primary_color,
        secondary_color: form.secondary_color,
        default_language: form.default_language,
        max_substitutions: form.max_substitutions,
        timeouts_per_set: form.timeouts_per_set,
        youtube_client_id: form.youtube_client_id?.trim() || null,
        youtube_playlist_id: form.youtube_playlist_id ? parsePlaylistId(form.youtube_playlist_id) : null,
        youtube_privacy: form.youtube_privacy ?? 'unlisted',
      })
      .eq('id', club.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(true);
    await refresh();
  }

  async function onLogo(file: File) {
    setError(null);
    // Només imatges sense codi (no SVG) i d'1 MB com a màxim (igual que el servidor)
    const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    if (!ALLOWED[file.type] || file.size > 1024 * 1024) {
      setError(t('club.logoInvalid'));
      return;
    }
    const ext = ALLOWED[file.type];
    const path = `${club.id}/logo-${Date.now()}.${ext}`;
    const up = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) {
      setError(up.error.message);
      return;
    }
    const old = club.logo_path;
    const { error } = await supabase.from('clubs').update({ logo_path: path }).eq('id', club.id);
    if (error) {
      setError(error.message);
      return;
    }
    if (old) await supabase.storage.from(LOGO_BUCKET).remove([old]);
    await refresh();
  }

  async function onRemoveLogo() {
    if (!club.logo_path) return;
    await supabase.storage.from(LOGO_BUCKET).remove([club.logo_path]);
    await supabase.from('clubs').update({ logo_path: null }).eq('id', club.id);
    await refresh();
  }

  async function onDeleteClub() {
    const answer = window.prompt(t('club.deleteClubConfirm'));
    if (answer?.trim() !== club.name) return;
    const { error } = await supabase.from('clubs').delete().eq('id', club.id);
    if (error) {
      setError(error.message);
      return;
    }
    selectClub(null);
    await refresh();
  }

  const logo = publicLogoUrl(club.logo_path);
  const disabled = !isAdmin;

  return (
    <div className="page">
      <PageHeader title={t('club.settingsTitle')} />

      <form onSubmit={onSave} className="stack card">
        <fieldset disabled={disabled} className="stack">
          <div className="grid-2">
            <label className="field">
              <span>{t('club.name')}</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} required minLength={2} />
            </label>
            <label className="field">
              <span>{t('club.shortName')}</span>
              <input value={form.short_name ?? ''} onChange={(e) => set('short_name', e.target.value)} maxLength={12} />
            </label>
          </div>

          <div className="grid-3">
            <label className="field">
              <span>{t('club.primaryColor')}</span>
              <input type="color" value={form.primary_color} onChange={(e) => set('primary_color', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('club.secondaryColor')}</span>
              <input type="color" value={form.secondary_color} onChange={(e) => set('secondary_color', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('club.defaultLanguage')}</span>
              <select value={form.default_language} onChange={(e) => set('default_language', e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2>{t('club.rules')}</h2>
          <div className="grid-3">
            <label className="field">
              <span>{t('club.maxSubstitutions')}</span>
              <input
                type="number"
                min={0}
                max={20}
                value={form.max_substitutions}
                onChange={(e) => set('max_substitutions', Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>{t('club.timeoutsPerSet')}</span>
              <input
                type="number"
                min={0}
                max={5}
                value={form.timeouts_per_set}
                onChange={(e) => set('timeouts_per_set', Number(e.target.value))}
              />
            </label>
          </div>

          <h2>{t('youtube.title')}</h2>
          <p className="small muted">{t('youtube.settingsHelp')}</p>
          <div className="grid-2">
            <label className="field">
              <span>{t('youtube.clientId')}</span>
              <input
                value={form.youtube_client_id ?? ''}
                onChange={(e) => set('youtube_client_id', e.target.value)}
                placeholder="123456789-xxxx.apps.googleusercontent.com"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>{t('youtube.playlist')}</span>
              <input
                value={form.youtube_playlist_id ?? ''}
                onChange={(e) => set('youtube_playlist_id', e.target.value)}
                placeholder="https://www.youtube.com/playlist?list=PL…"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>{t('youtube.privacy')}</span>
              <select value={form.youtube_privacy ?? 'unlisted'} onChange={(e) => set('youtube_privacy', e.target.value as Club['youtube_privacy'])}>
                <option value="unlisted">{t('youtube.unlisted')}</option>
                <option value="private">{t('youtube.private')}</option>
                <option value="public">{t('youtube.public')}</option>
              </select>
            </label>
          </div>
          <details className="small">
            <summary>{t('youtube.howTo')}</summary>
            <ol className="howto">
              <li>{t('youtube.step1')}</li>
              <li>{t('youtube.step2')}</li>
              <li>{t('youtube.step3')}</li>
              <li>{t('youtube.step4', { origin: window.location.origin })}</li>
              <li>{t('youtube.step5')}</li>
            </ol>
          </details>

          {error && <ErrorBox message={error} />}
          {isAdmin && (
            <div className="row">
              <button className="btn btn-primary" disabled={busy}>
                {busy ? t('common.saving') : t('common.save')}
              </button>
              {saved && <span className="ok">✓ {t('common.saved')}</span>}
            </div>
          )}
        </fieldset>
      </form>

      <section className="card stack">
        <h2>{t('club.logo')}</h2>
        <div className="row">
          {logo ? <img src={logo} alt="" className="club-logo-lg" /> : <span className="muted">—</span>}
          {isAdmin && (
            <>
              <label className="btn">
                {t('club.uploadLogo')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onLogo(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {logo && (
                <button className="btn" onClick={() => void onRemoveLogo()}>
                  {t('club.removeLogo')}
                </button>
              )}
            </>
          )}
        </div>
      </section>

      {isAdmin && (
        <section className="card stack danger">
          <h2>{t('club.dangerZone')}</h2>
          <button className="btn btn-danger" onClick={() => void onDeleteClub()}>
            {t('club.deleteClub')}
          </button>
        </section>
      )}
    </div>
  );
}
