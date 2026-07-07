import { useState, useMemo, useRef } from 'react';
import { Copy, Download, Upload, X, CheckCircle2, Languages } from 'lucide-react';

function extractEntries(rawJson) {
  const entries = [];
  const lpr = rawJson?.layoutParsingResults;
  if (!Array.isArray(lpr)) return entries;
  for (let i = 0; i < lpr.length; i++) {
    const list = lpr[i]?.prunedResult?.parsing_res_list;
    if (!Array.isArray(list)) continue;
    for (const block of list) {
      if (block?.block_content && block.block_content.trim() && !block.block_content.startsWith('<')) {
        entries.push({ key: `${i}_${block.block_id}`, src: block.block_content });
      }
    }
  }
  return entries;
}

function mergeTranslations(rawJson, translationMap) {
  const cloned = structuredClone(rawJson);
  const lpr = cloned?.layoutParsingResults;
  if (!Array.isArray(lpr)) return cloned;
  let applied = 0;
  for (let i = 0; i < lpr.length; i++) {
    const list = lpr[i]?.prunedResult?.parsing_res_list;
    if (!Array.isArray(list)) continue;
    for (const block of list) {
      const key = `${i}_${block.block_id}`;
      if (translationMap.has(key) && translationMap.get(key).trim()) {
        block.translated_text = translationMap.get(key);
        applied++;
      }
    }
  }
  return { data: cloned, applied };
}

export default function TranslateTool({ rawJson, translationMap, setTranslationMap, onApply, onClose }) {
  const [toast, setToast] = useState(null);
  const translateInputRef = useRef(null);

  const entries = useMemo(() => extractEntries(rawJson), [rawJson]);

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDownloadToTranslate = () => {
    const payload = entries.map(e => ({ key: e.key, src: e.src }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'to_translate.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已下載 to_translate.json', 'success');
  };

  const handleCopyPrompt = () => {
    const prompt = `你是一位專業的1930年的葡文法律專家，請將以下的葡文法典JSON翻譯成中文：

每筆資料結構：
- key: 唯一識別碼（請保留不變）
- src: 待翻譯原文（葡文）

請將附檔 (to_translate.json) 中的 src 欄位全部翻譯成中文，保留 key 不變。

請回傳 JSON 陣列，格式如下（只回傳此陣列，不要其他文字）：
[
  { "key": "0_1", "dst": "翻譯結果" },
  { "key": "0_2", "dst": "翻譯結果" }
]`;
    navigator.clipboard.writeText(prompt);
    showToast('已複製 LLM Prompt', 'success');
  };

  const handleUploadTranslations = (file) => {
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      showToast('請上傳 .json 檔案');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arr = JSON.parse(e.target.result);
        if (!Array.isArray(arr)) throw new Error('格式須為陣列');
        const map = new Map();
        for (const item of arr) {
          if (item.key != null && item.dst != null) {
            map.set(item.key, item.dst);
          }
        }
        setTranslationMap(map);
        showToast(`已載入 ${map.size} 筆翻譯`, 'success');
      } catch (err) {
        showToast(`翻譯檔案解析失敗：${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleApply = () => {
    if (translationMap.size === 0) {
      showToast('請先上傳翻譯結果');
      return;
    }
    const result = mergeTranslations(rawJson, translationMap);
    showToast(`已回填 ${result.applied} 筆翻譯`, 'success');
    setTimeout(() => onApply(result.data), 500);
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] max-h-[80vh] bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-700 shrink-0">
          <div className="flex items-center gap-2.5">
            <Languages size={20} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-stone-100">翻譯工具</h2>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {toast && (
            <div className={`text-xs px-3 py-2 rounded-lg ${toast.type === 'error' ? 'bg-red-600/20 text-red-400 border border-red-600/30' : 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/30'}`}>
              {toast.msg}
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-stone-300">步驟一：導出待翻譯清單</h3>
            <div className="bg-stone-800/50 border border-stone-700 rounded-xl px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-stone-400">已掃描區塊</span>
                <span className="text-sm font-mono text-stone-100">{entries.length} 筆</span>
              </div>
              <button
                onClick={handleDownloadToTranslate}
                disabled={entries.length === 0}
                className="w-full flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <Download size={14} /> 下載 to_translate.json
              </button>
              <button
                onClick={handleCopyPrompt}
                disabled={entries.length === 0}
                className="w-full flex items-center justify-center gap-1.5 bg-stone-700 hover:bg-stone-600 disabled:opacity-40 disabled:cursor-not-allowed text-stone-200 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <Copy size={14} /> 複製 LLM Prompt
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-stone-300">步驟二：回填翻譯結果</h3>
            <div className="bg-stone-800/50 border border-stone-700 rounded-xl px-4 py-3 space-y-2.5">
              <input
                ref={translateInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadTranslations(f); e.target.value = ''; }}
              />
              <button
                onClick={() => translateInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <Upload size={14} /> 上傳 translated.json
              </button>
              {translationMap.size > 0 && (
                <div className="flex items-center gap-2 text-xs text-emerald-400">
                  <CheckCircle2 size={14} />
                  已載入 {translationMap.size} 筆翻譯
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-stone-700 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors rounded-lg hover:bg-stone-800"
          >
            取消
          </button>
          <button
            onClick={handleApply}
            disabled={translationMap.size === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Languages size={14} /> 套用到檢視器
          </button>
        </div>
      </div>
    </div>
  );
}
