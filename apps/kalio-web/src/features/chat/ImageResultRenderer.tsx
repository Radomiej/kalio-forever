import { useState } from 'react';
import { Download, Maximize2 } from 'lucide-react';

export interface ImageResultData {
  image_url: string;
  path?: string;
  model?: string;
  size?: string;
  format?: string;
  download_url?: string;
  message?: string;
  refCount?: number;
  durationMs?: number;
  iteratedFrom?: string;
}

export function ImageResultRenderer({ data }: { data: ImageResultData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 space-y-1">
      <div className="relative group inline-block">
        <img
          src={data.image_url}
          alt={data.message ?? 'Generated image'}
          className="rounded-lg max-w-xs max-h-64 object-cover border border-base-300/30 cursor-pointer hover:opacity-95 transition-opacity"
          onClick={() => setExpanded(true)}
        />
        <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            title="View full size"
            className="btn btn-xs btn-circle bg-base-300/80 border-0 backdrop-blur-sm"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={10} />
          </button>
          {data.download_url && (
            <a
              href={data.download_url}
              download={data.path?.split('/').pop() ?? 'image.png'}
              title="Download"
              className="btn btn-xs btn-circle bg-base-300/80 border-0 backdrop-blur-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={10} />
            </a>
          )}
        </div>
      </div>

      {/* Metadata strip */}
      <div className="flex flex-wrap gap-2 text-[10px] font-mono text-base-content/30">
        {data.model && <span>{data.model}</span>}
        {data.size && <span>{data.size}</span>}
        {data.format && <span>.{data.format}</span>}
        {data.durationMs != null && <span>{(data.durationMs / 1000).toFixed(1)}s</span>}
        {data.refCount != null && <span>{data.refCount} ref(s)</span>}
        {data.path && <span className="text-base-content/20">{data.path}</span>}
      </div>

      {/* Full-size modal */}
      {expanded && (
        <dialog className="modal modal-open" onClick={() => setExpanded(false)}>
          <div className="modal-box max-w-4xl p-2" onClick={(e) => e.stopPropagation()}>
            <img
              src={data.image_url}
              alt={data.message ?? 'Generated image'}
              className="w-full h-auto rounded-lg"
            />
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="font-mono text-[10px] text-base-content/30">{data.path}</span>
              <div className="flex gap-2">
                {data.download_url && (
                  <a
                    href={data.download_url}
                    download={data.path?.split('/').pop() ?? 'image.png'}
                    className="btn btn-xs btn-ghost gap-1"
                  >
                    <Download size={11} /> Download
                  </a>
                )}
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => setExpanded(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setExpanded(false)} />
        </dialog>
      )}
    </div>
  );
}
