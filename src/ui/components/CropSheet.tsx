/**
 * Choose what the photograph is, before it becomes one - ENH-15, spec 032.
 *
 * Appears between picking a file and storing it. What leaves here IS the
 * original: there is no crop rectangle recorded anywhere, nothing downstream
 * learns a new concept, and every existing reader keeps working unchanged.
 *
 * CROPPING IS NEVER COMPULSORY. The selection starts as the whole frame and
 * "Use photo" with nothing moved stores the file byte-for-byte - `cropToBlob`
 * returns undefined for an untouched selection rather than re-encoding it,
 * so declining to crop costs no quality at all.
 *
 * Pointer events rather than mouse or touch: one code path covers a finger, a
 * trackpad and a stylus, and `setPointerCapture` keeps a drag alive when the
 * finger leaves the handle, which on a phone is most of them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Corner, type CropRect, isWholeFrame, moveRect, resizeRect, wholeFrame,
} from '@/data/media/crop';

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

export function CropSheet({ file, onDone, onCancel }: {
  file: Blob;
  /** `undefined` means "as it was" - the caller stores the file untouched. */
  onDone: (rect: CropRect | undefined) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const [rect, setRect] = useState<CropRect>();
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ corner?: Corner; lastX: number; lastY: number }>();

  useEffect(() => {
    const made = URL.createObjectURL(file);
    setUrl(made);
    // Deferred by a frame for the same reason blob-url.ts defers: revoking
    // synchronously can pull the URL out from under an <img> mid-paint.
    return () => { setTimeout(() => URL.revokeObjectURL(made), 100); };
  }, [file]);

  /** Source pixels per CSS pixel, so a drag moves the crop by what it looks like. */
  const scale = useCallback(() => {
    const el = frameRef.current;
    if (!el || !natural) return 1;
    return natural.width / el.getBoundingClientRect().width;
  }, [natural]);

  function onPointerDown(e: React.PointerEvent, corner?: Corner) {
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { corner, lastX: e.clientX, lastY: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !rect || !natural) return;
    const k = scale();
    const dx = (e.clientX - d.lastX) * k;
    const dy = (e.clientY - d.lastY) * k;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    setRect(d.corner ? resizeRect(rect, d.corner, dx, dy, natural) : moveRect(rect, dx, dy, natural));
  }

  function endDrag(e: React.PointerEvent) {
    if (!drag.current) return;
    try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    drag.current = undefined;
  }

  const untouched = !rect || !natural || isWholeFrame(rect, natural);

  /** The selection as percentages, so it tracks the image at any size. */
  const box = rect && natural ? {
    left: `${(rect.x / natural.width) * 100}%`,
    top: `${(rect.y / natural.height) * 100}%`,
    width: `${(rect.width / natural.width) * 100}%`,
    height: `${(rect.height / natural.height) * 100}%`,
  } : undefined;

  return (
    <section className="card stack">
      <strong>Crop this photo</strong>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        Drag the corners, or keep it as it is. Cropping now changes the picture
        that gets saved — there is no second copy to go back to.
      </p>

      <div
        className="crop"
        ref={frameRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {url && (
          <img
            className="crop__img"
            src={url}
            alt="The photo you are about to add"
            onLoad={(e) => {
              const img = e.currentTarget;
              const size = { width: img.naturalWidth, height: img.naturalHeight };
              setNatural(size);
              setRect(wholeFrame(size));
            }}
          />
        )}
        {box && (
          <div className="crop__box" style={box} onPointerDown={(e) => onPointerDown(e)}>
            {CORNERS.map((c) => (
              <span
                key={c}
                className={`crop__handle crop__handle--${c}`}
                onPointerDown={(e) => onPointerDown(e, c)}
                role="presentation"
              />
            ))}
          </div>
        )}
      </div>

      {rect && natural && (
        <p className="xs muted data" aria-live="polite" style={{ marginBottom: 0 }}>
          {untouched
            ? `Whole photo · ${natural.width} × ${natural.height}`
            : `${Math.round(rect.width)} × ${Math.round(rect.height)} of ${natural.width} × ${natural.height}`}
        </p>
      )}

      <button
        type="button"
        className="btn--primary"
        disabled={!natural}
        onClick={() => onDone(untouched ? undefined : rect)}
      >
        {untouched ? 'Use photo' : 'Use this crop'}
      </button>
      {!untouched && natural && (
        <button type="button" className="btn--ghost" onClick={() => setRect(wholeFrame(natural))}>
          Reset to the whole photo
        </button>
      )}
      <button type="button" className="btn--ghost" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
