"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, Footprints, Layers3, MapPinned, RotateCw, Route, UploadCloud } from "lucide-react";
import CalendarModal from "./CalendarModal";
import type { DashboardSnapshot } from "@/lib/dashboardData";
import type { ColorOpacities, WalkSummary } from "@/lib/walkTypes";
import { parseWalkFile } from "@/lib/parseWalkFile";
import { makeUploadBatches, type UploadBatch, type UploadItem } from "@/lib/uploadBatches";
import { generateWalkUrl } from "../utils/routeGenerator";

const Map = dynamic(() => import("./Map"), { ssr: false });
const initialOpacities: ColorOpacities = { blue: 6, cyan: 2.5, amber: 2.5, red: 2.5, purple: 2.5 };
const noWalks: DashboardSnapshot["walks"] = [];
const colorSettings = [
  { key: "blue", label: "Blue", color: "#4d9fff" },
  { key: "cyan", label: "Cyan", color: "#69d9ff" },
  { key: "amber", label: "Amber", color: "#f5a623" },
  { key: "red", label: "Red", color: "#f05b5b" },
  { key: "purple", label: "Purple", color: "#be85ff" },
] as const;

function dateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function DashboardClient({ initialSummary }: { initialSummary: WalkSummary | null }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeWalkId, setActiveWalkId] = useState<string | null>(null);
  const [viewRemaining, setViewRemaining] = useState(false);
  const [opacities, setOpacities] = useState<ColorOpacities>(initialOpacities);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0, phase: "preparing" as "preparing" | "saving" });
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  const loadSnapshot = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setLoadError(null);
    try {
      let loaded: DashboardSnapshot | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch("/api/dashboard", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
          if (!response.ok) throw new Error(`Dashboard request failed (${response.status}).`);
          loaded = await response.json() as DashboardSnapshot;
          if (!loaded || !Array.isArray(loaded.walks) || !loaded.summary || !loaded.progress) {
            throw new Error("The dashboard returned incomplete data.");
          }
          break;
        } catch (error) {
          if (controller.signal.aborted || attempt === 1) throw error;
          await new Promise(resolve => setTimeout(resolve, 700));
        }
      }
      if (!controller.signal.aborted && loaded) {
        setSnapshot(loaded);
        setStatus("ready");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus("error");
        setLoadError(readableError(error));
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadSnapshot(); });
    return () => { active = false; requestRef.current?.abort(); };
  }, [loadSnapshot]);

  const uploadFiles = async (files: FileList | File[]) => {
    if (isUploading) return;
    const validFiles = Array.from(files).filter(file => /\.(gpx|xml|fit|fit\.gz)$/i.test(file.name));
    if (!validFiles.length) {
      setMessage("Choose GPX or FIT walk files to upload.");
      return;
    }
    setIsUploading(true);
    setMessage(null);
    setUploadProgress({ current: 0, total: validFiles.length, phase: "preparing" });
    let saved = 0;
    let skipped = 0;
    const failedFiles = new Set<number>();
    const oversizedFiles = new Set<number>();
    const postBatch = async (batch: UploadBatch) => {
      const response = await fetch("/api/walks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: batch.body,
      });
      if (!response.ok) throw new Error(`Save failed (${response.status}).`);
      saved += batch.items.length;
    };
    try {
      for (let start = 0; start < validFiles.length; start += 20) {
        const items: UploadItem[] = [];
        const end = Math.min(start + 20, validFiles.length);
        for (let index = start; index < end; index++) {
          try {
            const walks = await parseWalkFile(validFiles[index]);
            if (!walks.length) skipped++;
            else for (const walk of walks) items.push({ walk, fileIndex: index });
          } catch (error) {
            console.error("Walk parsing failed", validFiles[index].name, error);
            failedFiles.add(index);
          }
          setUploadProgress({ current: index + 1, total: validFiles.length, phase: "preparing" });
        }
        const { batches, oversized } = makeUploadBatches(items);
        for (const item of oversized) {
          failedFiles.add(item.fileIndex);
          oversizedFiles.add(item.fileIndex);
        }
        setUploadProgress({ current: end, total: validFiles.length, phase: "saving" });
        for (const batch of batches) {
          try {
            await postBatch(batch);
          } catch (error) {
            console.error("Walk batch failed; retrying individually", error);
            // A malformed walk should not prevent the rest of the selection from saving.
            for (const item of batch.items) {
              try {
                const [single] = makeUploadBatches([item]).batches;
                await postBatch(single);
              } catch (singleError) {
                console.error("Walk upload failed", validFiles[item.fileIndex].name, singleError);
                failedFiles.add(item.fileIndex);
              }
            }
          }
        }
      }
      if (saved) {
        await loadSnapshot();
        setSelectedDate(null);
        setActiveWalkId(null);
      }
      setMessage(`${saved} walk${saved === 1 ? "" : "s"} saved${skipped ? ` · ${skipped} skipped` : ""}${failedFiles.size ? ` · ${failedFiles.size} failed` : ""}${oversizedFiles.size ? ` (${oversizedFiles.size} too large)` : ""}.`);
    } finally {
      setIsUploading(false);
    }
  };

  const summary = snapshot?.summary ?? initialSummary;
  const walks = snapshot?.walks ?? noWalks;
  const selectedDateWalks = useMemo(() => selectedDate ? walks.filter(walk => dateKey(walk.date) === dateKey(selectedDate)) : [], [selectedDate, walks]);
  const mapWalks = useMemo(() => activeWalkId ? walks.filter(walk => walk.id === activeWalkId) : selectedDate ? selectedDateWalks : walks, [activeWalkId, selectedDate, selectedDateWalks, walks]);
  const progress = snapshot?.progress;
  const completed = progress && progress.totalMiles > 0 ? Math.min(100, progress.walkedMiles / progress.totalMiles * 100) : 0;

  const planWalk = () => {
    if (!progress) return;
    const url = generateWalkUrl(progress.unwalkedGeoJSON);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setMessage("No remaining streets were found for a suggested walk.");
  };

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-panel">
        <div className="brand-row">
          <div className="brand-mark"><Footprints size={22} strokeWidth={2.2} /></div>
          <div><div className="eyebrow">DOWNTOWN MINNEAPOLIS</div><h1>Walk Atlas<span>.</span></h1></div>
        </div>
        <div className="panel-scroll">
          <div className="intro-row">
            <div><div className="section-kicker">YOUR CITY, STEP BY STEP</div><h2>{selectedDate ? "Walks on this day" : "A record of every mile."}</h2></div>
            <span className={`status-pill ${status}`}><span className="status-dot" />{status === "ready" ? "Up to date" : status === "loading" ? "Loading map" : "Connection issue"}</span>
          </div>
          {status === "error" && <div className="notice error" role="alert"><span>{loadError || "Could not load the map."}</span><button onClick={() => void loadSnapshot()}>Retry</button></div>}
          {message && <div className="notice" role="status">{message}</div>}

          {selectedDate ? (
            <section className="day-view">
              <button className="text-action" onClick={() => { setSelectedDate(null); setActiveWalkId(null); }}><ArrowLeft size={16} /> All walks</button>
              <h3>{new Date(selectedDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h3>
              <div className="day-list">{selectedDateWalks.map(walk => <button key={walk.id} className={`walk-item ${activeWalkId === walk.id ? "active" : ""}`} onClick={() => setActiveWalkId(activeWalkId === walk.id ? null : walk.id)}><span className="walk-item-name">{walk.name}</span><span className="walk-item-detail">{walk.distanceMiles.toFixed(2)} mi <span>·</span> {walk.steps.toLocaleString()} steps</span></button>)}</div>
              {!selectedDateWalks.length && <p className="muted">No walks found on this day.</p>}
            </section>
          ) : (
            <>
              <section className="metric-section" aria-label="Walking totals">
                <div className="hero-metric"><div className="metric-title">TOTAL DISTANCE</div><div className="hero-number">{summary ? summary.distanceMiles.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}<span> miles</span></div><div className="hero-caption">Across downtown and beyond</div></div>
                <div className="small-metrics"><div><span className="metric-title">WALKS LOGGED</span><strong>{summary ? summary.count.toLocaleString() : "—"}</strong></div><div><span className="metric-title">STEPS TAKEN</span><strong>{summary ? summary.steps.toLocaleString() : "—"}</strong></div></div>
              </section>
              <section className="progress-section">
                <div className="section-heading"><div><div className="section-kicker">THE DOWNTOWN GRID</div><h3>Streets explored</h3></div><Route size={19} /></div>
                <div className="progress-main"><strong>{progress ? `${completed.toFixed(1)}%` : "—"}</strong><span>complete</span></div>
                <div className="progress-track"><div style={{ width: `${completed}%` }} /></div>
                <div className="progress-labels"><span>{progress ? progress.walkedMiles.toFixed(1) : "—"} mi explored</span><span>{progress ? progress.remainingMiles.toFixed(1) : "—"} mi to go</span></div>
                <div className="segmented-control" role="group" aria-label="Map view"><button className={!viewRemaining ? "selected" : ""} onClick={() => setViewRemaining(false)}><Layers3 size={15} /> Heatmap</button><button className={viewRemaining ? "selected" : ""} onClick={() => setViewRemaining(true)}><MapPinned size={15} /> Remaining</button></div>
                <button className="route-button" onClick={planWalk} disabled={!progress}><span>Plan a walk</span><ArrowUpRight size={17} /></button>
              </section>
              <section className="controls-section"><div className="section-heading"><div><div className="section-kicker">MAKE THE MAP YOURS</div><h3>Heatmap intensity</h3></div></div><div className="sliders">{colorSettings.map(({ key, label, color }) => <label key={key} className="slider-row"><span className="swatch" style={{ background: color }} /><span>{label}</span><input aria-label={`${label} intensity`} disabled={viewRemaining} type="range" min="0.5" max="10" step="0.1" value={opacities[key]} onChange={event => setOpacities(previous => ({ ...previous, [key]: Number(event.target.value) }))} style={{ accentColor: color }} /><output>{opacities[key].toFixed(1)}×</output></label>)}</div></section>
              <section className="upload-section-new"><div className="section-heading"><div><div className="section-kicker">KEEP EXPLORING</div><h3>Add your walks</h3></div></div><div className={`drop-zone ${isDragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={event => { event.preventDefault(); setIsDragging(false); void uploadFiles(event.dataTransfer.files); }}><UploadCloud size={22} /><div><strong>{isUploading ? `${uploadProgress.phase === "saving" ? "Saving" : "Preparing"} ${uploadProgress.current} of ${uploadProgress.total} files` : "Drop GPX or FIT files here"}</strong><span>or choose files from your device</span></div><button disabled={isUploading} onClick={() => inputRef.current?.click()}>Browse files</button><input ref={inputRef} type="file" accept=".gpx,.xml,.fit,.fit.gz" multiple onChange={event => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ""; }} /></div></section>
            </>
          )}
        </div>
        <div className="panel-footer"><span><Check size={13} /> Walks saved to your dashboard</span><button onClick={() => setIsCalendarOpen(true)} disabled={!walks.length}><CalendarDays size={17} /> Calendar</button></div>
      </aside>
      <section className="map-stage" aria-label="Walking map">
        <Map walks={mapWalks} activeWalkId={activeWalkId} opacities={opacities} viewRemaining={viewRemaining} stridingResult={progress ?? null} heatmap={selectedDate ? null : snapshot?.heatmap ?? null} />
        <div className="map-topbar"><span className="map-location"><span className="map-location-dot" /> Minneapolis, MN</span><button onClick={() => void loadSnapshot()} aria-label="Refresh dashboard" disabled={status === "loading"}><RotateCw size={16} /> Refresh</button></div>
        {status === "loading" && <div className="map-loading" role="status"><span className="loading-spinner" /><strong>Drawing your map</strong><span>Your walking totals are ready. Routes are loading.</span></div>}
        {status === "error" && !snapshot && <div className="map-loading"><strong>Map unavailable</strong><span>Check the connection and try again.</span><button onClick={() => void loadSnapshot()}>Retry loading</button></div>}
        <div className="map-caption"><span className="caption-line" /><span>{selectedDate ? "SELECTED WALKS" : viewRemaining ? "STREETS TO EXPLORE" : "YOUR WALKING FOOTPRINT"}</span></div>
      </section>
      {isCalendarOpen && <CalendarModal walks={walks} onClose={() => setIsCalendarOpen(false)} onSelectDate={date => { setSelectedDate(date); setActiveWalkId(null); }} />}
    </main>
  );
}
