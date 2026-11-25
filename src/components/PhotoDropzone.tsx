import { useRef, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';

interface PhotoDropzoneProps {
  onFile: (file: File) => void;
  compact?: boolean;
}

export function PhotoDropzone({ onFile, compact = false }: PhotoDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const acceptFile = (file?: File) => {
    if (file) onFile(file);
  };

  return (
    <div
      className={`dropzone ${compact ? 'dropzone--compact' : ''} ${isDragging ? 'dropzone--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        acceptFile(event.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(event) => acceptFile(event.target.files?.[0])}
      />
      <div className="dropzone__icon"><ImagePlus size={compact ? 18 : 24} /></div>
      <div className="dropzone__copy">
        <strong>{compact ? 'Replace image' : 'Arrastrá una fotografía aquí'}</strong>
        <span>{compact ? 'JPG · PNG · WEBP · AVIF' : 'o seleccioná un archivo desde tu equipo · JPG, PNG, WebP'}</span>
      </div>
      <button className="button button--secondary button--small" onClick={() => inputRef.current?.click()}>
        <Upload size={14} /> Browse
      </button>
    </div>
  );
}
