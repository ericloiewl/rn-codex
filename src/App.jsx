import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Upload, Download, FileText, FileJson,
  RotateCcw, Edit3, X, AlertCircle, CheckCircle2, Type,
  File as FileIcon, Loader2, ChevronLeft, ChevronRight
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { lexer, parser } from 'marked';

const PRELOAD_COUNT = 3;
const PDF_WORKER_URL = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  const bg = type === 'error' ? 'bg-red-600' : 'bg-emerald-600';
  const Icon = type === 'error' ? AlertCircle : CheckCircle2;
  return (
    <div className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 ${bg} text-white px-5 py-3 rounded-xl shadow-2xl shadow-black/40 animate-slide-up`}>
      <Icon size={20} />
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 hover:text-white/70"><X size={16} /></button>
    </div>
  );
}

function parseOcrJson(data) {
  const lpr = data.layoutParsingResults;
  if (!Array.isArray(lpr) || lpr.length === 0) throw new Error('缺少 layoutParsingResults 陣列');
  const pages = lpr.map((entry, idx) => {
    const pr = entry.prunedResult;
    if (!pr) throw new Error(`頁面 ${idx + 1} 缺少 prunedResult`);
    if (!pr.width || !pr.height) throw new Error(`頁面 ${idx + 1} 缺少寬高`);
    const blocks = (pr.parsing_res_list || []).filter(b =>
      b.block_id != null &&
      Array.isArray(b.block_polygon_points) &&
      b.block_polygon_points.length === 4 &&
      b.block_polygon_points.every(p => Array.isArray(p) && p.length === 2)
    ).map(b => ({ ...b, _pid: idx }));
    return { width: pr.width, height: pr.height, blocks };
  });
  if (pages.length === 0) throw new Error('未找到任何頁面');
  if (pages.every(p => p.blocks.length === 0)) throw new Error('所有頁面均無有效區塊');
  return { pages, raw: data };
}

async function loadPdfDocument(file) {
  const buffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buffer }).promise;
}

async function renderPdfPageToBlob(pdfDoc, pageIndex, targetW, targetH) {
  const page = await pdfDoc.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const scale = Math.max(targetW / vp.width, targetH / vp.height);
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(scaled.width);
  canvas.height = Math.ceil(scaled.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  return { url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
}

function PageView({ pageIndex, pageData, pdfDoc, containerWidth, uploadImageUrl, sourceType, hoveredId, selectedId, onBboxHover, onBboxLeave, onBboxClick, getBlockStyle, preloadBound, onPageRendered, zoom }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const divRef = useRef(null);

  const isImageMode = sourceType === 'image';
  const displayW = containerWidth;
  const displayH = displayW * (pageData.height / pageData.width);

  useEffect(() => {
    if (isImageMode && uploadImageUrl && pageIndex === 0) {
      setImageUrl(uploadImageUrl);
      setIsLoaded(true);
      return;
    }
    if (!pdfDoc || isLoaded) return;
    const render = () => {
      setIsLoaded(true);
      renderPdfPageToBlob(pdfDoc, pageIndex, pageData.width, pageData.height)
        .then(r => {
          setImageUrl(r.url);
          onPageRendered(pageIndex);
        })
        .catch(err => console.error(`第 ${pageIndex + 1} 頁渲染失敗：`, err));
    };
    if (pageIndex <= preloadBound) {
      render();
      return;
    }
    const el = divRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        render();
      }
    }, { rootMargin: '800px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdfDoc, pageIndex, pageData, isLoaded, isImageMode, uploadImageUrl, preloadBound, onPageRendered]);

  const uid = (blockId) => `${pageIndex}:${blockId}`;

  const bboxToSvg = (points) => {
    if (!displayW || !displayH) return '';
    const sx = displayW / pageData.width;
    const sy = displayH / pageData.height;
    return points.map(([x, y]) => `${x * sx},${y * sy}`).join(' ');
  };

  const wrappedW = displayW * zoom;
  const wrappedH = displayH * zoom;

  return (
    <div
      className="relative mx-auto"
      style={{ width: wrappedW, height: wrappedH }}
    >
      <div
        ref={divRef}
        data-page-index={pageIndex}
        className="absolute"
        style={{
          width: displayW,
          height: displayH,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        {imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt={`第 ${pageIndex + 1} 頁`}
              className="block w-full h-full"
              draggable={false}
            />
            <svg
              width={displayW}
              height={displayH}
              className="absolute inset-0 pointer-events-auto"
              style={{ top: 0, left: 0 }}
            >
              {pageData.blocks.map(block => (
                <polygon
                  key={block.block_id}
                  points={bboxToSvg(block.block_polygon_points)}
                  className={getBlockStyle(uid(block.block_id))}
                  fillRule="evenodd"
                  onMouseEnter={e => onBboxHover(block, e, pageIndex)}
                  onMouseLeave={onBboxLeave}
                  onClick={() => onBboxClick(block, pageIndex)}
                />
              ))}
            </svg>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-stone-800/20">
            <div className="flex flex-col items-center gap-2 text-stone-600">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-xs">第 {pageIndex + 1} 頁</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [imageFile, setImageFile] = useState(null);
  const [jsonFile, setJsonFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [pagesData, setPagesData] = useState([]);
  const [rawJson, setRawJson] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const [edits, setEdits] = useState({});
  const [toast, setToast] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sourceType, setSourceType] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [preloadBound, setPreloadBound] = useState(PRELOAD_COUNT - 1);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isAutoFit, setIsAutoFit] = useState(true);

  const handlePageRendered = useCallback((pageIndex) => {
    setPreloadBound(prev => Math.min(Math.max(prev, pageIndex + PRELOAD_COUNT), pagesData.length - 1));
  }, [pagesData.length]);

  const scrollRef = useRef(null);
  const textListRef = useRef(null);
  const imgInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const pdfProcessedRef = useRef(false);

  const showToast = useCallback((message, type = 'error') => setToast({ message, type }), []);
  const closeToast = useCallback(() => setToast(null), []);

  const totalPages = pagesData.length;

  const allTextBlocks = useMemo(() => {
    const result = [];
    for (let p = 0; p < totalPages; p++) {
      for (const block of pagesData[p]?.blocks || []) {
        if (block.block_content && block.block_content.trim()) {
          result.push({ ...block, _pageIndex: p });
        }
      }
    }
    return result;
  }, [pagesData, totalPages]);

  const uid = useCallback((pageIndex, blockId) => `${pageIndex}:${blockId}`, []);

  const groupLookup = useMemo(() => {
    const lookup = new Map();
    for (let p = 0; p < totalPages; p++) {
      const byGroup = new Map();
      for (const block of pagesData[p]?.blocks || []) {
        const gid = block.group_id;
        if (gid != null) {
          if (!byGroup.has(gid)) byGroup.set(gid, []);
          byGroup.get(gid).push(block);
        }
      }
      for (const [, blocks] of byGroup) {
        if (blocks.length > 1) {
          const uids = blocks.map(b => uid(p, b.block_id));
          for (const b of blocks) {
            lookup.set(uid(p, b.block_id), uids);
          }
        }
      }
    }
    return lookup;
  }, [pagesData, totalPages, uid]);

  const hoveredUids = useMemo(() => groupLookup.get(hoveredId) || (hoveredId ? [hoveredId] : []), [groupLookup, hoveredId]);
  const selectedUids = useMemo(() => groupLookup.get(selectedId) || (selectedId ? [selectedId] : []), [groupLookup, selectedId]);

  const handleImageUpload = useCallback((file) => {
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
    if (!file.type.startsWith('image/') && !isPdf) {
      showToast('請上傳圖片檔案 (PNG/JPG) 或 PDF');
      return;
    }
    pdfProcessedRef.current = false;
    setPdfDoc(null);
    setSourceType(isPdf ? 'pdf' : 'image');
    setImageFile(file);
    if (!isPdf) {
      setImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    } else {
      setImageUrl(null);
    }
    setPagesData([]);
    setRawJson(null);
    setJsonFile(null);
    setEdits({});
    setHoveredId(null);
    setSelectedId(null);
    setDataLoaded(false);
    setPreloadBound(PRELOAD_COUNT - 1);
    setZoom(1);
    setIsAutoFit(true);
  }, [showToast]);

  const handleJsonUpload = useCallback((file) => {
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      showToast('請上傳 .json 檔案');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const parsed = parseOcrJson(data);
        setPagesData(parsed.pages);
        setRawJson(parsed.raw);
        setJsonFile(file);
        setEdits({});
        setHoveredId(null);
        setSelectedId(null);
        setPreloadBound(PRELOAD_COUNT - 1);
        setZoom(1);
        setIsAutoFit(true);
      } catch (err) {
        showToast(`JSON 解析失敗：${err.message}`);
      }
    };
    reader.onerror = () => showToast('讀取 JSON 檔案失敗');
    reader.readAsText(file);
  }, [showToast]);

  useEffect(() => {
    if (sourceType !== 'pdf' || pagesData.length === 0 || !imageFile) return;
    if (pdfProcessedRef.current) return;
    pdfProcessedRef.current = true;
    setGlobalLoading(true);
    loadPdfDocument(imageFile)
      .then(doc => {
        if (doc.numPages !== pagesData.length) {
          throw new Error(`PDF 頁數 (${doc.numPages}) 與 JSON 頁數 (${pagesData.length}) 不符`);
        }
        setPdfDoc(doc);
        setDataLoaded(true);
      })
      .catch(err => showToast(`PDF 解析失敗：${err.message}`))
      .finally(() => setGlobalLoading(false));
  }, [sourceType, pagesData, imageFile, showToast]);

  useEffect(() => {
    if (sourceType !== 'image' || pagesData.length === 0) return;
    setDataLoaded(true);
  }, [sourceType, pagesData]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateWidth = () => setContainerWidth(el.clientWidth);
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dataLoaded]);

  useEffect(() => {
    if (!dataLoaded || !containerWidth || pagesData.length === 0) return;
    if (!isAutoFit) return;
    const el = scrollRef.current;
    if (!el) return;
    const visibleHeight = el.clientHeight;
    const p0 = pagesData[0];
    const displayH = containerWidth * (p0.height / p0.width);
    const fitZ = Math.min(1, visibleHeight / displayH);
    setZoom(fitZ);
  }, [dataLoaded, containerWidth, isAutoFit, pagesData]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setIsAutoFit(false);
        setZoom(prev => {
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          return Math.max(0.25, Math.min(5, prev + delta));
        });
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    if (!dataLoaded || totalPages === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const containerTop = el.getBoundingClientRect().top;
      let closestIdx = currentPage;
      let closestDist = Infinity;
      const pageEls = el.querySelectorAll('[data-page-index]');
      for (const pageEl of pageEls) {
        const idx = parseInt(pageEl.dataset.pageIndex, 10);
        const rect = pageEl.getBoundingClientRect();
        const dist = Math.abs(rect.top - containerTop);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      }
      if (closestIdx !== currentPage) setCurrentPage(closestIdx);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [dataLoaded, totalPages, currentPage]);

  const handleBboxHover = useCallback((block, e, pageIndex) => {
    setHoveredId(uid(pageIndex, block.block_id));
  }, [uid]);

  const handleBboxLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  const handleBboxClick = useCallback((block, pageIndex) => {
    const id = uid(pageIndex, block.block_id);
    setSelectedId(id);
    const row = textListRef.current?.querySelector(`[data-uid="${id}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [uid]);

  const handleTextHover = useCallback((id) => setHoveredId(id), []);
  const handleTextLeave = useCallback(() => setHoveredId(null), []);
  const handleTextClick = useCallback((id) => {
    setSelectedId(id);
    const [pageStr] = id.split(':');
    const pageIndex = parseInt(pageStr, 10);
    if (!isNaN(pageIndex)) {
      setCurrentPage(pageIndex);
      const el = scrollRef.current?.querySelector(`[data-page-index="${pageIndex}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleEditChange = useCallback((id, text) => {
    setEdits(prev => {
      if (text == null) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: text };
    });
  }, []);

  const getCurrentText = useCallback((block) => edits[uid(block._pageIndex, block.block_id)] ?? block.block_content, [edits, uid]);

  const handleExportJson = useCallback(() => {
    if (!rawJson) return;
    const cloned = JSON.parse(JSON.stringify(rawJson));
    for (let p = 0; p < cloned.layoutParsingResults.length; p++) {
      const list = cloned.layoutParsingResults[p].prunedResult?.parsing_res_list;
      if (!list) continue;
      for (const block of list) {
        const key = uid(p, block.block_id);
        if (edits[key] != null) block.block_content = edits[key];
      }
    }
    const blob = new Blob([JSON.stringify(cloned, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rn-codex_corrected.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON 匯出成功', 'success');
  }, [rawJson, edits, uid, showToast]);

  const handleExportTxt = useCallback(() => {
    const lines = [];
    for (let p = 0; p < totalPages; p++) {
      if (totalPages > 1) lines.push(`--- 第 ${p + 1} 頁 ---`);
      for (const block of pagesData[p]?.blocks || []) {
        if (block.block_content && block.block_content.trim() && !block.block_content.startsWith('<')) {
          lines.push(edits[uid(p, block.block_id)] ?? block.block_content);
        }
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rn-codex.txt';
    a.click();
    URL.revokeObjectURL(url);
    showToast('文字檔匯出成功', 'success');
  }, [pagesData, totalPages, edits, uid, showToast]);

  const getBlockStyle = useCallback((blockUid) => {
    const base = 'cursor-pointer transition-all duration-150';
    const isHovered = hoveredUids.includes(blockUid);
    const isSelected = selectedUids.includes(blockUid);
    if (isHovered && isSelected) return `${base} stroke-amber-400 fill-amber-400/20 stroke-[2.5]`;
    if (isSelected) return `${base} stroke-indigo-400 fill-indigo-400/20 stroke-[2.5]`;
    if (isHovered) return `${base} stroke-amber-400 fill-amber-400/20 stroke-[2.5]`;
    return `${base} stroke-none fill-transparent`;
  }, [hoveredUids, selectedUids]);

  const getRowStyle = useCallback((blockUid) => {
    const base = 'border-l-2 px-4 py-2 text-sm transition-all duration-150 cursor-pointer';
    const isHovered = hoveredUids.includes(blockUid);
    const isSelected = selectedUids.includes(blockUid);
    if (isHovered && isSelected) return `${base} border-amber-400 bg-amber-400/10`;
    if (isSelected) return `${base} border-indigo-400 bg-indigo-400/10`;
    if (isHovered) return `${base} border-amber-400/60 bg-stone-700/50`;
    return `${base} border-transparent hover:bg-stone-800/50`;
  }, [hoveredUids, selectedUids]);

  const renderSourceIcon = () => {
    if (sourceType === 'pdf') return <FileIcon size={15} className="text-red-400" />;
    return <Upload size={15} />;
  };

  const rows = useMemo(() => {
    let globalIdx = 0;
    const r = [];
    for (let p = 0; p < totalPages; p++) {
      for (const block of pagesData[p]?.blocks || []) {
        if (!block.block_content || !block.block_content.trim()) continue;
        const id = uid(p, block.block_id);
        const currentText = getCurrentText(block);
        const isEdited = edits[id] != null;
        const isHtml = block.block_content.trim().startsWith('<');
        r.push(
          <div
            key={id}
            data-uid={id}
            className={`${getRowStyle(id)} group/item relative`}
            onMouseEnter={() => handleTextHover(id)}
            onMouseLeave={handleTextLeave}
            onClick={() => handleTextClick(id)}
          >
            <div className="flex items-start gap-1.5">
              <span className="text-[10px] text-stone-500 font-mono mt-1 w-5 shrink-0 text-right">
                {++globalIdx}
              </span>
              <span className="text-[9px] font-mono text-indigo-400 bg-indigo-400/10 border border-indigo-400/20 rounded mt-1 px-1.5 py-[1px] shrink-0">{p + 1}</span>
              <div className="flex-1 min-w-0">
                {isHtml ? (
                  (() => {
                    switch (block.block_label) {
                      case 'image':
                      case 'header_image':
                        return (
                          <div className="flex items-center gap-2 bg-stone-700/30 border border-stone-600/50 rounded px-3 py-4">
                            <span className="text-xs text-stone-500">[image]</span>
                          </div>
                        );
                      case 'table':
                        return (
                          <div className="bg-stone-700/30 border border-stone-600/50 rounded overflow-x-auto">
                            <div className="px-2 py-1 text-[10px] text-stone-500 bg-stone-700/50 border-b border-stone-600/50">table</div>
                            <div className="p-2 text-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-stone-600 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-stone-600 [&_th]:px-2 [&_th]:py-1" dangerouslySetInnerHTML={{ __html: currentText }} />
                          </div>
                        );
                      default:
                        return (
                          <div className="flex items-center gap-2 bg-stone-700/30 border border-stone-600/50 rounded px-3 py-4">
                            <span className="text-xs text-stone-500">[{block.block_label}]</span>
                          </div>
                        );
                    }
                  })()
                ) : isEdited ? (
                  <div className="flex items-center gap-1">
                    <input
                      className="w-full bg-stone-700 border border-stone-600 rounded px-2 py-1 text-xs text-stone-100 outline-none focus:border-indigo-500 transition-colors"
                      value={currentText}
                      onChange={e => handleEditChange(id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                    />
                    <button
                      onClick={e => { e.stopPropagation(); handleEditChange(id, null); }}
                      className="text-stone-500 hover:text-red-400 shrink-0"
                      title="還原"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 group">
                    <span
                      className="flex-1 leading-relaxed [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-stone-100 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-stone-100 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-stone-100 [&_h4]:text-xs [&_h4]:font-bold [&_h4]:text-stone-200 [&_h5]:text-xs [&_h5]:font-semibold [&_h5]:text-stone-200 [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:text-stone-300 [&_p]:m-0 [&_p]:inline [&_strong]:font-semibold [&_strong]:text-stone-100 [&_em]:italic [&_code]:bg-stone-700 [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px] [&_pre]:bg-stone-700 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_a]:text-indigo-400 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-stone-500 [&_blockquote]:pl-2 [&_blockquote]:text-stone-400 [&_hr]:border-stone-600 [&_hr]:my-1"
                      dangerouslySetInnerHTML={{ __html: parser(lexer(currentText)) }}
                    />
                    <button
                      onClick={e => { e.stopPropagation(); handleEditChange(id, currentText); }}
                      className="text-stone-600 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                      title="編輯"
                    >
                      <Edit3 size={13} />
                    </button>
                  </div>
                )}
                <div className="opacity-0 group-hover/item:opacity-100 transition-opacity duration-150 flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-mono text-stone-500 bg-stone-800 px-1.5 py-0.5 rounded border border-stone-700">{block.block_label}</span>
                  {block.block_bbox && (
                    <span className="text-[10px] font-mono text-stone-600 bg-stone-800 px-1.5 py-0.5 rounded border border-stone-700">
                      {Math.round(block.block_bbox[0])},{Math.round(block.block_bbox[1])}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      }
    }
    return r;
  }, [pagesData, totalPages, uid, edits, getCurrentText, getRowStyle, handleTextHover, handleTextLeave, handleTextClick]);

  return (
    <div className="h-screen w-screen flex flex-col bg-stone-900 text-stone-200 overflow-hidden select-none">
      {toast && <Toast message={toast.message} type={toast.type} onClose={closeToast} />}

      <header className="h-14 flex items-center gap-3 px-5 border-b border-stone-700 bg-stone-800/50 shrink-0">
        <FileText size={22} className="text-indigo-400" />
        <h1 className="text-base font-semibold tracking-tight">RN Codex</h1>
        <div className="w-px h-6 bg-stone-700 mx-1" />

        <input
          ref={imgInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,application/pdf,.pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }}
        />
        <button
          onClick={() => imgInputRef.current?.click()}
          className="flex items-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors h-8"
        >
          {renderSourceIcon()}
          {imageFile ? imageFile.name : '上傳圖片 / PDF'}
        </button>

        <input
          ref={jsonInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleJsonUpload(f); e.target.value = ''; }}
        />
        <button
          onClick={() => jsonInputRef.current?.click()}
          className="flex items-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors h-8"
        >
          <FileJson size={15} />
          {jsonFile ? jsonFile.name : '上傳 OCR JSON'}
        </button>

        <div className="flex-1" />

        {dataLoaded && (
          <>
            <button onClick={handleExportJson}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors h-8">
              <Download size={15} /> 匯出 JSON
            </button>
            <button onClick={handleExportTxt}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors h-8">
              <Type size={15} /> 匯出 TXT
            </button>
          </>
        )}
      </header>

      <main className="flex-1 flex min-h-0">
        <div className="w-[60%] flex flex-col min-h-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-stone-950"
        >
          {!dataLoaded && !globalLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-500 gap-4">
              <Upload size={48} className="text-stone-600" />
              <p className="text-sm">請上傳原始檔案（圖片/PDF）與 PaddleOCR JSON 以開始檢視</p>
              <div className="flex gap-3 mt-1">
                <button onClick={() => imgInputRef.current?.click()}
                  className="flex items-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs px-4 py-2 rounded-lg">
                  {renderSourceIcon()} 選擇檔案
                </button>
                <button onClick={() => jsonInputRef.current?.click()}
                  className="flex items-center gap-1.5 bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs px-4 py-2 rounded-lg">
                  <FileJson size={14} /> 選擇 JSON
                </button>
              </div>
            </div>
          ) : globalLoading ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-400 gap-3">
              <Loader2 size={28} className="animate-spin text-indigo-400" />
              <p className="text-sm">正在載入 PDF 文檔...</p>
            </div>
          ) : dataLoaded && containerWidth > 0 ? (
            <>
              {pagesData.map((pageData, idx) => (
                <PageView
                  key={idx}
                  pageIndex={idx}
                  pageData={pageData}
                  pdfDoc={pdfDoc}
                  containerWidth={containerWidth}
                  uploadImageUrl={imageUrl}
                  sourceType={sourceType}
                  hoveredId={hoveredId}
                  selectedId={selectedId}
                  onBboxHover={handleBboxHover}
                  onBboxLeave={handleBboxLeave}
                  onBboxClick={handleBboxClick}
                  getBlockStyle={getBlockStyle}
                  preloadBound={preloadBound}
                  onPageRendered={handlePageRendered}
                  zoom={zoom}
                />
              ))}

            </>
            ) : null}
          </div>

          {dataLoaded && (
            <footer className="h-12 shrink-0 flex items-center justify-center gap-3 border-t border-stone-700 bg-stone-800/50 px-4 text-xs">
              <button
                onClick={() => {
                  const next = Math.max(0, currentPage - 1);
                  setCurrentPage(next);
                  const el = scrollRef.current?.querySelector(`[data-page-index="${next}"]`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                disabled={currentPage === 0}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} /> 上一頁
              </button>

              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={currentPage + 1}
                  onChange={e => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val <= totalPages) {
                      const idx = val - 1;
                      setCurrentPage(idx);
                      const el = scrollRef.current?.querySelector(`[data-page-index="${idx}"]`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                  className="w-12 bg-stone-700 border border-stone-600 rounded px-1 py-0.5 text-xs text-center text-stone-100 outline-none focus:border-indigo-500 transition-colors [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-stone-500">/ {totalPages}</span>
              </div>

              <button
                onClick={() => {
                  const next = Math.min(totalPages - 1, currentPage + 1);
                  setCurrentPage(next);
                  const el = scrollRef.current?.querySelector(`[data-page-index="${next}"]`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                disabled={currentPage === totalPages - 1}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                下一頁 <ChevronRight size={16} />
              </button>

              <div className="w-px h-5 bg-stone-700" />

              <button
                onClick={() => {
                  setIsAutoFit(true);
                  const el = scrollRef.current;
                  if (el && pagesData.length > 0 && containerWidth) {
                    const visibleHeight = el.clientHeight;
                    const p0 = pagesData[0];
                    const displayH = containerWidth * (p0.height / p0.width);
                    setZoom(Math.min(1, visibleHeight / displayH));
                  }
                  scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-stone-700 transition-colors"
              >
                <RotateCcw size={14} /> 重置視角
              </button>

              <span className="text-stone-500 font-mono w-10 text-right">{Math.round(zoom * 100)}%</span>
            </footer>
          )}
          </div>

        {dataLoaded && (
          <aside className="w-[40%] shrink-0 border-l border-stone-700 flex flex-col bg-stone-800/30">
            <div className="h-10 flex items-center px-4 border-b border-stone-700 shrink-0 gap-2">
              <span className="text-xs font-medium text-stone-400">
                文字列表
                <span className="ml-2 text-stone-600">({allTextBlocks.length} 行)</span>
              </span>
              <span className="text-[10px] text-stone-500">懸停/點擊可雙向同步</span>
            </div>
            <div ref={textListRef} className="flex-1 overflow-y-auto scroll-smooth">
              {rows}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

export default App;
