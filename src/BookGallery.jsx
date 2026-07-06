import { useState } from 'react';
import { FileText, Upload, FileJson } from 'lucide-react';

function Thumbnail({ entry }) {
  const [failed, setFailed] = useState(false);

  if (entry.thumbnail && !failed) {
    return (
      <img
        src={entry.thumbnail}
        alt={entry.name}
        className="w-full h-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-700 to-stone-800">
      <FileText size={40} className="text-stone-500/60" />
    </div>
  );
}

export default function BookGallery({ datasets, onSelect, imgInputRef, jsonInputRef }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-stone-500 gap-6 px-6">
      {datasets.length > 0 && (
        <>
          <p className="text-sm text-stone-400 font-medium">選擇範例資料集</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 max-w-2xl">
            {datasets.map((ds, i) => (
              <button
                key={i}
                onClick={() => onSelect(ds)}
                className="flex flex-col items-center gap-2 group cursor-pointer"
              >
                <div className="w-28 h-36 rounded-lg overflow-hidden ring-1 ring-stone-700 group-hover:ring-indigo-500/60 group-hover:shadow-lg group-hover:shadow-indigo-500/10 transition-all duration-200">
                  <Thumbnail entry={ds} />
                </div>
                <span className="text-xs text-stone-500 group-hover:text-stone-300 transition-colors font-medium text-center leading-tight max-w-28">
                  {ds.name}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-1">
            <div className="h-px w-16 bg-stone-700" />
            <span className="text-[10px] text-stone-600 uppercase tracking-widest font-medium">或自行上傳</span>
            <div className="h-px w-16 bg-stone-700" />
          </div>
        </>
      )}
      <div className="flex gap-3">
        <button
          onClick={() => imgInputRef.current?.click()}
          className="flex items-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Upload size={14} /> 選擇檔案
        </button>
        <button
          onClick={() => jsonInputRef.current?.click()}
          className="flex items-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <FileJson size={14} /> 選擇 JSON
        </button>
      </div>
    </div>
  );
}
