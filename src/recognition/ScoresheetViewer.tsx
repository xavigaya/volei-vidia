import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

// Visor de l'acta oficial (PDF o imatge) per transcriure-la al costat del
// formulari. El fitxer no surt del dispositiu: no es puja enlloc.

type Doc =
  | { kind: 'image'; url: string; name: string }
  | { kind: 'pdf'; pages: number; name: string; render: (page: number, canvas: HTMLCanvasElement, scale: number) => Promise<void> };

async function loadPdf(file: File): Promise<Doc> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return {
    kind: 'pdf',
    pages: pdf.numPages,
    name: file.name,
    render: async (n, canvas, scale) => {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
    },
  };
}

export function ScoresheetViewer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [page, setPage] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Pàgina sense girar (imatge o PDF renderitzat)
  const [source, setSource] = useState<CanvasImageSource & { width: number; height: number } | null>(null);

  // Allibera la imatge en tancar
  useEffect(() => () => {
    if (doc?.kind === 'image') URL.revokeObjectURL(doc.url);
  }, [doc]);

  useEffect(() => {
    setSource(null);
    if (!doc) return;
    if (doc.kind === 'image') {
      const img = new Image();
      img.onload = () => setSource(img);
      img.onerror = () => setError(t('recognition.sheet.viewer.unsupported'));
      img.src = doc.url;
      return;
    }
    // Resolució alta perquè la lletra a mà es llegeixi bé en ampliar
    const c = document.createElement('canvas');
    doc
      .render(page, c, 2.5)
      .then(() => setSource(c))
      .catch((e: Error) => setError(e.message));
  }, [doc, page, t]);

  // Dibuixa la pàgina girada
  useEffect(() => {
    const out = canvasRef.current;
    if (!out || !source) return;
    const sideways = rotation % 180 !== 0;
    out.width = sideways ? source.height : source.width;
    out.height = sideways ? source.width : source.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    ctx.restore();
  }, [source, rotation]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) setDoc(await loadPdf(file));
      else if (file.type.startsWith('image/')) setDoc({ kind: 'image', url: URL.createObjectURL(file), name: file.name });
      else setError(t('recognition.sheet.viewer.unsupported'));
      setPage(1);
      setRotation(0);
      setZoom(1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card rec-viewer stack-sm">
      <div className="row wrap rec-viewer-tools">
        <label className="btn btn-sm">
          {doc ? t('recognition.sheet.viewer.change') : t('recognition.sheet.viewer.open')}
          <input type="file" accept="application/pdf,image/*" onChange={(e) => void onFile(e)} hidden />
        </label>
        {doc && (
          <>
            <button className="btn btn-sm" onClick={() => setRotation((r) => (r + 270) % 360)} title={t('recognition.sheet.viewer.rotateLeft')}>
              ⟲
            </button>
            <button className="btn btn-sm" onClick={() => setRotation((r) => (r + 90) % 360)} title={t('recognition.sheet.viewer.rotateRight')}>
              ⟳
            </button>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label={t('recognition.sheet.viewer.zoomOut')}>
              −
            </button>
            <span className="small mono">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-sm" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label={t('recognition.sheet.viewer.zoomIn')}>
              +
            </button>
            {doc.kind === 'pdf' && doc.pages > 1 && (
              <span className="row small">
                <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ‹
                </button>
                {page}/{doc.pages}
                <button className="btn btn-sm" disabled={page >= doc.pages} onClick={() => setPage((p) => p + 1)}>
                  ›
                </button>
              </span>
            )}
          </>
        )}
        <button className="btn btn-sm rec-viewer-close" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
      {busy && <div className="muted small">{t('app.loading')}</div>}
      {error && <div className="warn small">{error}</div>}
      {!doc && !busy && <p className="muted small">{t('recognition.sheet.viewer.help')}</p>}
      {doc && (
        <div className="rec-viewer-frame">
          <canvas ref={canvasRef} className="rec-viewer-page" style={{ width: `${zoom * 100}%` }} role="img" aria-label={doc.name} />
        </div>
      )}
    </div>
  );
}
