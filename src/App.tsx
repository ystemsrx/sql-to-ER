import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type Ref,
} from "react";
import G6 from "@antv/g6";
import { I18N, isInitialSampleInput } from "./i18n";
import type { Language } from "./i18n";
import { detectLang } from "./language";
import { patchRelationshipLinkPoints, registerCustomNodes } from "./builder";
import { CodeEditor } from "./codeEditor";
import { SwitchControl } from "./components/SwitchControl";
import {
  ArrowsUpDownLeftRightIcon,
  CircleNodesIcon,
  ClockRotateLeftIcon,
  EyeIcon,
  EyeSlashIcon,
  ListUlIcon,
  PaletteIcon,
} from "./components/icons";
import * as Exporter from "./exporter";
import * as Snapshots from "./snapshots";
import type { SnapshotRecord } from "./types";
import { HistoryOverlay } from "./HistoryOverlay";
import { useGraph } from "./hooks/useGraph";
import { useExportButton } from "./hooks/useExportButton";
import type { ExportFormat, ExportDoneCallback } from "./hooks/useExportButton";
import { useUndoRedoShortcuts } from "./hooks/useUndoRedoShortcuts";
import { useWheelZoomRotate } from "./hooks/useWheelZoomRotate";
import { canPlaceLegendInPreviewHeader } from "./legendPlacement";

registerCustomNodes(G6);

const FONT_SCALE_MIN = 0.4;
const FONT_SCALE_MAX = 1.6;
const FONT_SCALE_RANGE = FONT_SCALE_MAX - FONT_SCALE_MIN;
const SKILL_INSTALL_COMMAND = "npx skills add ystemsrx/sql-to-ER";
const PREVIEW_HEADER_GAP = 16;

const App = () => {
  const initialLang = detectLang() as Language;
  const [lang, setLang] = useState<Language>(initialLang);
  const t = I18N[lang];
  const [showBackground, setShowBackground] = useState(true);
  const [skillCommandCopied, setSkillCommandCopied] = useState(false);
  const skillCopyTimerRef = useRef<number | null>(null);
  const [legendPlacement, setLegendPlacement] = useState<"preview" | "top">("preview");
  const previewHeaderRef = useRef<HTMLDivElement | null>(null);
  const previewTitleRef = useRef<HTMLHeadingElement | null>(null);
  const previewActionsRef = useRef<HTMLDivElement | null>(null);
  const legendMeasureRef = useRef<HTMLDivElement | null>(null);
  // 历史面板常驻为 opacity: 0 的关闭态，确保首次打开也能触发 CSS 渐显。
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<SnapshotRecord[]>([]);
  const historyRefreshTimerRef = useRef<number | null>(null);

  const {
    containerRef,
    graphRef,
    historyRef,
    lastInputRef,
    inputText,
    isColored,
    showComment,
    hideFields,
    fontScale,
    forceOn,
    autoAvoid,
    hasGraph,
    error,
    errorVisible,
    parserWarnings,
    parserWarningsVisible,
    loading,
    setError,
    setInputText,
    setIsColored,
    setShowComment,
    setHideFields,
    setFontScale,
    setForceOn,
    setAutoAvoid,
    handleGenerate,
    dismissParserWarnings,
    handleQuickLayout,
    handleArrangeLayout,
    restoreFromSnapshot,
    persistCurrentSnapshot,
    settleAfterRotation,
  } = useGraph({ t, initialLang });

  // 监听语言切换事件（由顶部 vanilla 脚本派发）。
  // 用户尚未修改示例时连同示例一起替换并立即重新生成；
  // 不再走 ref+effect 的间接路径。
  useEffect(() => {
    const onLang = (e: Event) => {
      const detail = (e as CustomEvent<{ lang?: Language }>).detail;
      const nextLang = detail && detail.lang;
      if (!nextLang || nextLang === lang) return;
      const usingDefaultSample = inputText === I18N.zh.sample || inputText === I18N.en.sample;
      setLang(nextLang);
      if (usingDefaultSample) {
        const nextSample = I18N[nextLang].sample;
        setInputText(nextSample);
        handleGenerate({ inputText: nextSample });
      }
    };
    window.addEventListener("sql2er-lang", onLang);
    return () => window.removeEventListener("sql2er-lang", onLang);
  }, [lang, inputText, setInputText, handleGenerate]);

  // 导出 SVG/PNG/Drawio - 使用 Exporter 模块。
  // exporter 只上报错误码，这里映射为当前语言的文案。
  const exportErrorText: Record<Exporter.ExportErrorCode, string> = {
    "export-no-graph": t.errExportNoGraph,
    "export-svg-failed": t.errExportSvg,
    "export-png-failed": t.errExportPng,
    "export-drawio-failed": t.errExportDrawio,
  };
  const onExportError = (code: Exporter.ExportErrorCode) => setError(exportErrorText[code] ?? code);

  const handleExportSVG = (onDone: ExportDoneCallback) => {
    if (!hasGraph || !graphRef.current) {
      onDone(new Error("no-graph"));
      return;
    }
    Exporter.exportSVG({
      graphRef,
      hasGraph,
      containerRef,
      onError: onExportError,
      onDone,
      patchRelationshipLinkPoints,
      G6,
    });
  };

  const handleExportPNG = (onDone: ExportDoneCallback) => {
    if (!hasGraph || !graphRef.current) {
      onDone(new Error("no-graph"));
      return;
    }
    Exporter.exportPNG({
      graphRef,
      hasGraph,
      containerRef,
      onError: onExportError,
      onDone,
      patchRelationshipLinkPoints,
      G6,
    });
  };

  const handleExportDrawio = (onDone: ExportDoneCallback) => {
    if (!hasGraph || !graphRef.current) {
      onDone(new Error("no-graph"));
      return;
    }
    Exporter.exportDrawio({
      graphRef,
      hasGraph,
      onError: onExportError,
      onDone,
      patchRelationshipLinkPoints,
    });
  };

  const runExport = (fmt: ExportFormat, onDone: ExportDoneCallback) => {
    if (fmt === "PNG") handleExportPNG(onDone);
    else if (fmt === "XML") handleExportDrawio(onDone);
    else handleExportSVG(onDone);
  };

  const {
    exportState,
    exportView,
    exportFmt,
    exportProgress,
    exportBtnRef,
    onExportBtnClick,
    onExportBtnKey,
    toExportIdle,
    kbActiveFmt,
  } = useExportButton({ hasGraph, runExport, onError: setError });

  useUndoRedoShortcuts({
    graphRef,
    historyRef,
    // 撤销/重做前先停掉持续力导向，避免力循环与补间动画互写坐标
    onBeforeChange: () => {
      if (forceOn) setForceOn(false);
    },
    onAfterChange: () => {
      void persistCurrentSnapshot();
    },
  });
  useWheelZoomRotate({
    containerRef,
    graphRef,
    historyRef,
    onAfterChange: settleAfterRotation,
  });

  // 切换背景显示
  const handleToggleBackground = () => {
    setShowBackground(!showBackground);
  };

  const handleCopySkillInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(SKILL_INSTALL_COMMAND);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = SKILL_INSTALL_COMMAND;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setSkillCommandCopied(true);
    if (skillCopyTimerRef.current !== null) window.clearTimeout(skillCopyTimerRef.current);
    skillCopyTimerRef.current = window.setTimeout(() => {
      setSkillCommandCopied(false);
      skillCopyTimerRef.current = null;
    }, 1400);
  };

  // ─── 生成历史 ───────────────────────────────────────────
  // 打开历史面板：
  //  1) 立刻用 IndexedDB 里的现有数据把面板撑起来（点击不卡）；
  //  2) 在后台为当前画面拍一张矢量快照、写库；写完再静默刷新一次列表。
  // 这样用户拖动后点开面板，先看到上次的状态，约 1s 后卡片自动换成
  // 包含最新位置的缩略图 —— 不用关掉再开。
  const sortByUpdated = (xs: SnapshotRecord[]) =>
    xs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const openHistory = async () => {
    try {
      const items = await Snapshots.getAll();
      setHistoryItems(sortByUpdated(items.filter((item) => !isInitialSampleInput(item.inputText))));
    } catch (e) {
      console.warn("snapshots getAll failed", e);
      setHistoryItems([]);
    }
    setHistoryOpen(true);

    // 1440px WebP 的 SVG 光栅化和编码可能占用一帧以上。等 400ms 渐显结束后
    // 再刷新当前快照，避免首次打开时与 opacity / backdrop-filter 合成抢主线程。
    if (graphRef.current && lastInputRef.current) {
      if (historyRefreshTimerRef.current !== null) {
        window.clearTimeout(historyRefreshTimerRef.current);
      }
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      historyRefreshTimerRef.current = window.setTimeout(
        async () => {
          historyRefreshTimerRef.current = null;
          const input = lastInputRef.current;
          if (!graphRef.current || !input) return;
          const id = Snapshots.hashInput(input);
          await persistCurrentSnapshot();
          // 只取刚更新的这一条做局部替换，不再全量重读（getAll 会把所有
          // 缩略图一起读进内存，开一次面板读两遍很浪费）。
          try {
            const fresh = await Snapshots.get(id);
            if (!fresh || isInitialSampleInput(fresh.inputText)) return;
            setHistoryItems((prev) =>
              sortByUpdated([fresh, ...prev.filter((x) => x.id !== fresh.id)]),
            );
          } catch (_) {}
        },
        reduceMotion ? 0 : 420,
      );
    }
  };

  const closeHistory = () => setHistoryOpen(false);

  const handleRestore = (snap: SnapshotRecord) => {
    restoreFromSnapshot(snap);
    setHistoryOpen(false);
  };

  const updateFontScaleFromPointer = (clientX: number, clientY: number, el: HTMLDivElement) => {
    const track = el.querySelector(".font-size-slider-track");
    const rect = (track ?? el).getBoundingClientRect();
    const isHorizontal = rect.width > rect.height;
    const rawPct = isHorizontal
      ? (clientX - rect.left) / rect.width
      : 1 - (clientY - rect.top) / rect.height;
    const pct = Math.min(1, Math.max(0, rawPct));
    setFontScale(FONT_SCALE_MIN + pct * FONT_SCALE_RANGE);
  };

  // setFontScale 每次调用都会全图重算尺寸并 refresh；120Hz 指针下按事件频率
  // 执行必然掉帧。这里把 pointermove 合并成每帧最多一次。
  const fontSliderFrameRef = useRef<number | null>(null);
  const fontSliderPendingRef = useRef<{ x: number; y: number; el: HTMLDivElement } | null>(null);
  const scheduleFontScaleFromPointer = (clientX: number, clientY: number, el: HTMLDivElement) => {
    fontSliderPendingRef.current = { x: clientX, y: clientY, el };
    if (fontSliderFrameRef.current !== null) return;
    fontSliderFrameRef.current = requestAnimationFrame(() => {
      fontSliderFrameRef.current = null;
      const pending = fontSliderPendingRef.current;
      fontSliderPendingRef.current = null;
      if (pending) updateFontScaleFromPointer(pending.x, pending.y, pending.el);
    });
  };
  useEffect(
    () => () => {
      if (fontSliderFrameRef.current !== null) cancelAnimationFrame(fontSliderFrameRef.current);
    },
    [],
  );

  const handleFontSliderPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFontScaleFromPointer(e.clientX, e.clientY, e.currentTarget);
  };

  const handleFontSliderPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    scheduleFontScaleFromPointer(e.clientX, e.clientY, e.currentTarget);
  };

  const handleFontSliderKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = e.shiftKey ? 0.1 : 0.03;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      setFontScale(fontScale + delta);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFontScale(fontScale - delta);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFontScale(FONT_SCALE_MIN);
    } else if (e.key === "End") {
      e.preventDefault();
      setFontScale(FONT_SCALE_MAX);
    }
  };

  const deleteSnapshot = async (id: string) => {
    try {
      await Snapshots.deleteById(id);
      setHistoryItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      console.warn("snapshot delete failed", e);
    }
  };

  // 关闭历史面板的快捷键：Esc
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHistory();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  useEffect(
    () => () => {
      if (historyRefreshTimerRef.current !== null) {
        window.clearTimeout(historyRefreshTimerRef.current);
      }
    },
    [],
  );

  // 历史面板开着时给 body 加标记，CSS 据此把右上角的语言胶囊隐去
  // —— 它的 z-index 比覆盖层高，否则会浮在卡片轨道之上。
  useEffect(() => {
    if (historyOpen) {
      document.body.classList.add("history-open");
    } else {
      document.body.classList.remove("history-open");
    }
    return () => document.body.classList.remove("history-open");
  }, [historyOpen]);

  useEffect(
    () => () => {
      if (skillCopyTimerRef.current !== null) window.clearTimeout(skillCopyTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const updateLegendPlacement = () => {
      const header = previewHeaderRef.current;
      const title = previewTitleRef.current;
      const actions = previewActionsRef.current;
      const legend = legendMeasureRef.current;
      if (!header || !title || !actions || !legend) return;

      const headerStyle = window.getComputedStyle(header);
      const horizontalPadding =
        parseFloat(headerStyle.paddingLeft || "0") + parseFloat(headerStyle.paddingRight || "0");
      const gap = parseFloat(headerStyle.columnGap || headerStyle.gap || "") || PREVIEW_HEADER_GAP;
      const nextPlacement = canPlaceLegendInPreviewHeader({
        headerWidth: header.getBoundingClientRect().width,
        horizontalPadding,
        titleWidth: title.getBoundingClientRect().width,
        legendWidth: legend.getBoundingClientRect().width,
        actionsWidth: actions.getBoundingClientRect().width,
        gap,
      })
        ? "preview"
        : "top";

      setLegendPlacement((current) => (current === nextPlacement ? current : nextPlacement));
    };

    updateLegendPlacement();
    const frame = window.requestAnimationFrame(updateLegendPlacement);
    const resizeObserver = new ResizeObserver(updateLegendPlacement);
    [
      previewHeaderRef.current,
      previewTitleRef.current,
      previewActionsRef.current,
      legendMeasureRef.current,
    ]
      .filter(Boolean)
      .forEach((el) => resizeObserver.observe(el as Element));

    void document.fonts?.ready.then(updateLegendPlacement);
    window.addEventListener("resize", updateLegendPlacement);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateLegendPlacement);
    };
  }, [lang]);

  useEffect(() => {
    document.body.classList.toggle("legend-top-visible", legendPlacement === "top");
    return () => document.body.classList.remove("legend-top-visible");
  }, [legendPlacement]);

  // 时间戳格式化（按当前语言显示本地化的"几秒前 / 时间戳"）
  const formatTimestamp = (ts: number | undefined) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      const diff = Date.now() - ts;
      const min = Math.floor(diff / 60000);
      if (min < 1) return t.timeJustNow;
      if (min < 60) return t.timeMinAgo.replace("{n}", String(min));
      const hr = Math.floor(min / 60);
      if (hr < 24) return t.timeHrAgo.replace("{n}", String(hr));
      return d.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  };

  // HistoryOverlay 是 memo 组件；通过 ref + useCallback 提供恒定引用的回调，
  // 让 App 的高频 re-render（如字号滑块拖动）不再连带整个卡片轨道重渲。
  const historyCbRef = useRef({
    close: closeHistory,
    restore: handleRestore,
    remove: deleteSnapshot,
    format: formatTimestamp,
  });
  historyCbRef.current = {
    close: closeHistory,
    restore: handleRestore,
    remove: deleteSnapshot,
    format: formatTimestamp,
  };
  const onHistoryClose = useCallback(() => historyCbRef.current.close(), []);
  const onHistoryRestore = useCallback(
    (snap: SnapshotRecord) => historyCbRef.current.restore(snap),
    [],
  );
  const onHistoryDelete = useCallback((id: string) => historyCbRef.current.remove(id), []);
  const onHistoryFormatTimestamp = useCallback(
    (ts: number | undefined) => historyCbRef.current.format(ts),
    [],
  );

  const fontSliderPct = ((fontScale - FONT_SCALE_MIN) / FONT_SCALE_RANGE) * 100;

  const renderDiagramLegend = (
    className: string,
    ref?: Ref<HTMLDivElement>,
    ariaHidden = false,
  ) => (
    <div ref={ref} className={className} aria-hidden={ariaHidden || undefined}>
      <div className="legend-item" style={{ padding: "4px 10px", fontSize: "0.8rem" }}>
        <div
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "3px",
            background: isColored ? "#e0f2fe" : "#fff",
            border: isColored ? "2px solid #0ea5e9" : "2px solid #1e293b",
          }}
        ></div>
        <span>{t.legendEntity}</span>
      </div>
      <div className="legend-item" style={{ padding: "4px 10px", fontSize: "0.8rem" }}>
        <div
          style={{
            width: "10px",
            height: "10px",
            transform: "rotate(45deg)",
            background: isColored ? "#f5f3ff" : "#fff",
            border: isColored ? "2px solid #8b5cf6" : "2px solid #1e293b",
          }}
        ></div>
        <span style={{ marginLeft: "4px" }}>{t.legendRelation}</span>
      </div>
      <div className="legend-item" style={{ padding: "4px 10px", fontSize: "0.8rem" }}>
        <div
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "50%",
            background: "#fff",
            border: isColored ? "2px solid #94a3b8" : "2px solid #1e293b",
          }}
        ></div>
        <span>{t.legendAttribute}</span>
      </div>
      <div className="legend-item" style={{ padding: "4px 10px", fontSize: "0.8rem" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "2px",
          }}
        >
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: isColored ? "#ecfdf5" : "#fff",
              border: isColored ? "2px solid #10b981" : "2px solid #1e293b",
              boxSizing: "border-box",
            }}
          ></div>
          <div
            style={{
              width: "10px",
              height: "2px",
              borderRadius: "999px",
              background: isColored ? "#10b981" : "#1e293b",
            }}
          ></div>
        </div>
        <span style={{ fontWeight: 600 }}>{t.legendPk}</span>
      </div>
    </div>
  );

  return (
    <>
      <div className="skill-install-pill" aria-label={t.ariaInstallSkill}>
        <code>{SKILL_INSTALL_COMMAND}</code>
        <span className="skill-install-copy-cap">
          <button
            type="button"
            className="skill-install-copy"
            aria-label={skillCommandCopied ? t.ariaCopiedInstall : t.ariaCopyInstall}
            title={skillCommandCopied ? t.tipCopied : t.tipCopy}
            onClick={handleCopySkillInstallCommand}
          >
            {skillCommandCopied ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4.5" y="8.5" width="10" height="10" rx="2" />
                <rect x="8.5" y="4.5" width="10" height="10" rx="2" fill="#fff" stroke="none" />
                <rect x="8.5" y="4.5" width="10" height="10" rx="2" />
              </svg>
            )}
          </button>
        </span>
      </div>
      {renderDiagramLegend(
        `diagram-legend diagram-legend--top${legendPlacement === "top" ? " is-visible" : ""}`,
      )}
      {renderDiagramLegend("diagram-legend diagram-legend--measure", legendMeasureRef, true)}
      <div className="main-content">
        <div className="input-section">
          <div className="card">
            <div
              className="card-header"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h2 className="card-title">
                <span style={{ fontSize: "1.5rem" }}>📄</span>
                {t.cardInputTitle}
              </h2>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <SwitchControl
                  label={t.showComment}
                  checked={showComment}
                  onChange={setShowComment}
                />
              </div>
            </div>
            <div className="card-content">
              <div className="sql-editor-frame">
                <CodeEditor
                  value={inputText}
                  onChange={setInputText}
                  placeholder={t.editorPlaceholder}
                />
              </div>
              <div className="button-group">
                <button
                  className="btn btn-primary"
                  onClick={() => handleGenerate()}
                  disabled={loading}
                >
                  {loading ? (
                    <div
                      className="spinner"
                      style={{ width: 20, height: 20, borderWidth: 2 }}
                    ></div>
                  ) : (t.btnGenerate as string) === (t.btnGenerateShort as string) ? (
                    // 长短标签一致（如英文）时不需要切换动效，直接渲染文本
                    t.btnGenerate
                  ) : (
                    <span className="btn-primary-label-stack" data-compact={exportState !== "idle"}>
                      <span className="label-long">{t.btnGenerate}</span>
                      <span className="label-short">{t.btnGenerateShort}</span>
                    </span>
                  )}
                </button>
                <div className="export-btn-wrap">
                  <button
                    ref={exportBtnRef}
                    type="button"
                    className="export-btn"
                    data-state={exportState}
                    disabled={!hasGraph}
                    onClick={onExportBtnClick}
                    onKeyDown={onExportBtnKey}
                    aria-label={t.btnExportLabel}
                    aria-haspopup="menu"
                    aria-expanded={exportState === "open"}
                  >
                    <div
                      className="export-progress"
                      style={{
                        width: `${exportProgress}%`,
                        transitionDuration:
                          exportProgress >= 100 ? "220ms" : exportProgress > 0 ? "2400ms" : "300ms",
                        transitionTimingFunction:
                          exportProgress >= 100
                            ? "cubic-bezier(0.2, 0.7, 0.2, 1)"
                            : exportProgress > 0
                              ? "cubic-bezier(0, 0.6, 0.2, 1)"
                              : "cubic-bezier(0, 0, 0.2, 1)",
                      }}
                    />

                    <div
                      className={`export-view export-view-idle${exportView === "idle" ? " is-on" : ""}`}
                    >
                      <span className="idle-label">{t.btnExportLabel}</span>
                      <svg
                        className="arrow-icon"
                        viewBox="0 0 14 14"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M7 2v7.5m0 0l-3-3m3 3l3-3M2.5 12h9" />
                      </svg>
                    </div>

                    <div
                      className={`export-view export-view-open${exportView === "open" ? " is-on" : ""}`}
                      role="menu"
                    >
                      {(["PNG", "XML", "SVG"] as const).map((fmt, i, arr) => (
                        <Fragment key={fmt}>
                          <div
                            className={`export-opt${kbActiveFmt === fmt ? " is-kbd-active" : ""}`}
                            data-fmt={fmt}
                            role="menuitem"
                          >
                            <span className="export-opt-label">{fmt}</span>
                          </div>
                          {i < arr.length - 1 && <div className="export-sep" />}
                        </Fragment>
                      ))}
                      <div className="export-sep" />
                      <div
                        className="export-cancel"
                        onClick={(e) => {
                          e.stopPropagation();
                          toExportIdle();
                        }}
                        role="menuitem"
                        aria-label={t.ariaCancel}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" x2="6" y1="6" y2="18" />
                          <line x1="6" x2="18" y1="6" y2="18" />
                        </svg>
                      </div>
                    </div>

                    <div
                      className={`export-view export-view-loading${exportView === "loading" ? " is-on" : ""}`}
                      aria-live="polite"
                    >
                      <svg
                        className="export-spinner"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      <span className="loading-label">
                        {t.exportGenerating} {exportFmt}...
                      </span>
                    </div>

                    <div
                      className={`export-view export-view-success${exportView === "success" ? " is-on" : ""}`}
                      aria-live="polite"
                    >
                      <svg
                        className="check-icon"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M2.5 7.2l3 3 6-6" />
                      </svg>
                      <span className="success-label">{t.exportSaved}</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="output-section">
          <div className="card">
            <div ref={previewHeaderRef} className="card-header preview-card-header">
              <h2 ref={previewTitleRef} className="card-title" style={{ whiteSpace: "nowrap" }}>
                <span style={{ fontSize: "1.5rem" }}>🎨</span>
                {t.cardPreviewTitle}
              </h2>
              {legendPlacement === "preview" &&
                renderDiagramLegend("diagram-legend diagram-legend--preview")}

              <div ref={previewActionsRef} className="preview-header-actions">
                <button
                  className="btn btn-sm btn-accent"
                  onClick={handleArrangeLayout}
                  disabled={!hasGraph || loading}
                >
                  {t.btnSmartLayout}
                </button>
                <button
                  className="btn btn-sm btn-accent"
                  onClick={handleQuickLayout}
                  disabled={!hasGraph || loading}
                >
                  {t.btnQuickLayout}
                </button>
              </div>
            </div>

            <div
              className="card-content"
              style={{
                position: "relative",
                padding: 0,
                display: "flex",
                flexDirection: "column",
                height: "100%",
              }}
            >
              <div
                className={`diagram-container ${showBackground ? "" : "no-grid"}`}
                style={{ border: "none", borderRadius: 0 }}
              >
                <button
                  type="button"
                  className="background-toggle"
                  onClick={handleToggleBackground}
                  title={showBackground ? t.tipHideBg : t.tipShowBg}
                  aria-label={showBackground ? t.tipHideBg : t.tipShowBg}
                  aria-pressed={!showBackground}
                >
                  {showBackground ? <EyeIcon /> : <EyeSlashIcon />}
                </button>
                <button
                  type="button"
                  className={`colorize-toggle ${isColored ? "active" : ""}`}
                  onClick={() => setIsColored(!isColored)}
                  title={isColored ? t.tipColorOff : t.tipColorOn}
                  aria-label={isColored ? t.tipColorOff : t.tipColorOn}
                  aria-pressed={isColored}
                >
                  <PaletteIcon />
                </button>
                <button
                  type="button"
                  className={`attrs-toggle ${hideFields ? "active" : ""}`}
                  onClick={() => setHideFields(!hideFields)}
                  title={hideFields ? t.tipShowAttrs : t.tipHideAttrs}
                  aria-label={hideFields ? t.tipShowAttrs : t.tipHideAttrs}
                  aria-pressed={hideFields}
                >
                  <ListUlIcon />
                </button>
                <button
                  type="button"
                  className="history-toggle"
                  onClick={openHistory}
                  title={t.tipHistory}
                  aria-label={t.tipHistory}
                >
                  <ClockRotateLeftIcon />
                </button>
                <button
                  type="button"
                  className={`force-toggle ${forceOn ? "active" : ""}`}
                  onClick={() => setForceOn(!forceOn)}
                  title={forceOn ? t.tipForceOff : t.tipForceOn}
                  aria-label={forceOn ? t.tipForceOff : t.tipForceOn}
                  aria-pressed={forceOn}
                >
                  <CircleNodesIcon />
                </button>
                <button
                  type="button"
                  className={`avoid-toggle ${autoAvoid ? "active" : ""}`}
                  onClick={() => setAutoAvoid(!autoAvoid)}
                  title={autoAvoid ? t.tipAutoAvoidOff : t.tipAutoAvoidOn}
                  aria-label={autoAvoid ? t.tipAutoAvoidOff : t.tipAutoAvoidOn}
                  aria-pressed={autoAvoid}
                >
                  <ArrowsUpDownLeftRightIcon />
                </button>
                <div
                  className="font-size-slider"
                  title={t.tipFontSize}
                  role="slider"
                  tabIndex={0}
                  aria-label={t.tipFontSize}
                  aria-valuemin={FONT_SCALE_MIN}
                  aria-valuemax={FONT_SCALE_MAX}
                  aria-valuenow={Number(fontScale.toFixed(2))}
                  style={
                    {
                      "--font-slider-pct": `${fontSliderPct}%`,
                    } as CSSProperties
                  }
                  onPointerDown={handleFontSliderPointerDown}
                  onPointerMove={handleFontSliderPointerMove}
                  onKeyDown={handleFontSliderKeyDown}
                >
                  <span className="font-size-slider-mark font-size-slider-mark-large">A</span>
                  <div className="font-size-slider-track" aria-hidden="true">
                    <div className="font-size-slider-fill" />
                    <div className="font-size-slider-thumb" />
                  </div>
                  <span className="font-size-slider-mark font-size-slider-mark-small">A</span>
                </div>
                {loading && (
                  <div className="loading-overlay">
                    <div className="spinner"></div>
                  </div>
                )}
                {error && (
                  <div className={`diagram-error-overlay${errorVisible ? " is-visible" : ""}`}>
                    <div className="error-message">⚠️ {error}</div>
                  </div>
                )}
                {parserWarnings.length > 0 && (
                  <div
                    className={`parser-warning-toast${parserWarningsVisible ? " is-visible" : ""}`}
                    role="status"
                    aria-live="polite"
                  >
                    <button
                      type="button"
                      className="parser-warning-close"
                      aria-label={t.warnDismiss}
                      onClick={dismissParserWarnings}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="18" x2="6" y1="6" y2="18" />
                        <line x1="6" x2="18" y1="6" y2="18" />
                      </svg>
                    </button>
                    <div className="parser-warning-title">{t.warnTitle}</div>
                    <ul className="parser-warning-list">
                      {parserWarnings.slice(0, 4).map((warning, index) => (
                        <li key={`${warning.code}-${warning.line ?? "x"}-${index}`}>
                          {warning.message}
                        </li>
                      ))}
                    </ul>
                    {parserWarnings.length > 4 && (
                      <div className="parser-warning-more">
                        {t.warnMore.replace("{n}", String(parserWarnings.length - 4))}
                      </div>
                    )}
                  </div>
                )}
                <div
                  ref={containerRef}
                  style={{
                    width: "100%",
                    height: "100%",
                    position: "relative",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      <HistoryOverlay
        open={historyOpen}
        items={historyItems}
        t={t}
        onClose={onHistoryClose}
        onRestore={onHistoryRestore}
        onDelete={onHistoryDelete}
        formatTimestamp={onHistoryFormatTimestamp}
      />
    </>
  );
};

export default App;
