import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Paperclip, Trash2 } from 'lucide-react';
import {
  CAMPUS_MEDIA_ACCEPT_ATTRIBUTE,
  getCampusMediaUrl,
  removeCampusMedia,
  uploadCampusMedia,
  validateCampusMediaFile,
  type CampusMediaScope
} from '../lib/campusMedia';

export interface FileUploaderProps {
  /** Must match the folder the object is filed under, or the guard rejects it. */
  scope: CampusMediaScope;
  /** Currently stored storage path, or null when nothing is attached. */
  value: string | null;
  /** Fires with the new path (or null after a removal) once storage is settled. */
  onChange: (path: string | null) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Called with a human-readable message so the parent can toast it too. */
  onError?: (message: string) => void;
}

/**
 * The single uploader for the private campus-media bucket. Every consumer —
 * assignment attachments, lost & found photos, event covers — routes through
 * this so validation and the storage path convention live in one place
 * (ff.md 31: do not duplicate similar components).
 *
 * The file is uploaded the moment it is chosen, so `onChange` always receives a
 * durable path rather than a pending File. Callers that later fail to save the
 * owning row are responsible for calling removeCampusMedia(path).
 */
export function FileUploader({
  scope,
  value,
  onChange,
  label = 'Attach a file',
  hint = 'JPG, PNG, WebP or PDF, up to 10 MB.',
  disabled = false,
  onError
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState('');

  // Resolve a thumbnail for stored image media. Signed URLs are short-lived and
  // only resolve for users the storage read policy admits, so '' is expected for
  // other people's private files and simply renders no image.
  useEffect(() => {
    let cancelled = false;
    setFileName(value ? value.split('/').pop()!.replace(/^\d+-[0-9a-f]{8}-/, '') : '');
    if (!value) {
      setPreview('');
      return;
    }
    void getCampusMediaUrl(value).then((url) => {
      if (!cancelled) setPreview(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const report = (message: string) => {
    setProblem(message);
    onError?.(message);
  };

  const clearInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  const handlePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    if (!picked) return;
    setBusy(true);
    setProblem('');
    try {
      // Validate before spending bandwidth so a rejected file costs nothing.
      await validateCampusMediaFile(picked);
      const previous = value;
      const path = await uploadCampusMedia(picked, scope);
      onChange(path);
      if (previous) await removeCampusMedia(previous);
    } catch (cause) {
      report(cause instanceof Error ? cause.message : 'That file could not be uploaded.');
    } finally {
      clearInput();
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await removeCampusMedia(value);
      onChange(null);
      setPreview('');
    } catch {
      report('The file could not be removed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="media-picker">
      <input
        ref={inputRef}
        type="file"
        accept={CAMPUS_MEDIA_ACCEPT_ATTRIBUTE}
        onChange={(event) => void handlePick(event)}
        className="sr-only"
        disabled={disabled || busy}
        id={`media-${scope}-${label.replace(/\W+/g, '-').toLowerCase()}`}
      />
      <div className="media-picker-row">
        {preview ? (
          <img className="media-picker-thumb" src={preview} alt="" />
        ) : value ? (
          <span className="media-picker-thumb is-file" aria-hidden="true">
            <FileText size={18} />
          </span>
        ) : null}
        <div className="media-picker-body">
          <span className="media-picker-label">
            {value ? fileName || 'Attached file' : label}
          </span>
          <span className="media-picker-hint">{hint}</span>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
          {value ? 'Replace' : 'Choose file'}
        </button>
        {value && (
          <button
            type="button"
            className="secondary-btn media-picker-remove"
            onClick={() => void handleRemove()}
            disabled={disabled || busy}
            aria-label="Remove attached file"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {problem && (
        <p className="media-picker-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Thumbnail for an already-stored media path, used in read-only listings. */
export function MediaThumbnail({ path, alt }: { path: string | null; alt: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    setUrl('');
    if (!path) return;
    void getCampusMediaUrl(path).then((resolved) => {
      if (!cancelled) setUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return null;
  if (!url) {
    return (
      <span className="media-picker-thumb is-file" title={alt}>
        <ImageIcon size={18} />
      </span>
    );
  }
  return <img className="media-picker-thumb" src={url} alt={alt} />;
}
