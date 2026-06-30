"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { UploadCloud, Footprints, Map as MapIcon, Calendar as CalendarIcon, Trash2, ArrowLeft } from "lucide-react";
import GPXParser from "gpxparser";
import FitParser from "fit-file-parser";
import pako from "pako";
import localforage from "localforage";
import { Buffer } from "buffer";
import CalendarModal from "./components/CalendarModal";
import type { StridingResult } from "./utils/streetMatcher";
import { generateWalkUrl } from "./utils/routeGenerator";

// Dynamically import Map with ssr disabled because Leaflet uses window object
const Map = dynamic(() => import("./components/Map"), {
  ssr: false,
  loading: () => <div style={{ flex: 1, backgroundColor: 'var(--bg-primary)' }}></div>
});

export type ColorOpacities = {
  green: number;
  yellow: number;
  orange: number;
  red: number;
  purple: number;
};

export type Walk = {
  id: string;
  name: string;
  date: string;
  points: [number, number][];
  distanceMiles: number;
  steps: number;
};

export default function Home() {
  const [walks, setWalks] = useState<Walk[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [activeWalkId, setActiveWalkId] = useState<string | null>(null);
  const [opacities, setOpacities] = useState<ColorOpacities>({
    green: 2.5,
    yellow: 2.5,
    orange: 2.5,
    red: 2.5,
    purple: 2.5
  });
  const [stridingResult, setStridingResult] = useState<StridingResult | null>(null);
  const [viewRemaining, setViewRemaining] = useState(false);
  
  // Load from Postgres API on mount
  useEffect(() => {
    fetch('/api/walks', { cache: 'no-store' })
      .then(res => res.json())
      .then((saved) => {
        if (Array.isArray(saved)) {
          setWalks(saved);
        }
      })
      .catch(e => console.error("Failed to load saved walks", e));
  }, []);

  useEffect(() => {
    if (walks.length > 0) {
      fetch('/downtown-streets.geojson')
        .then(res => res.json())
        .then(geojson => {
          setTimeout(() => {
            import('./utils/streetMatcher').then(({ processCityStriding }) => {
              const result = processCityStriding(walks, geojson);
              setStridingResult(result);
            }).catch(e => console.error("Matcher Error:", e));
          }, 100); // Small delay to let React render the heatmap first
        })
        .catch(err => console.error('Failed to load streets', err));
    }
  }, [walks]);

  const parseFile = (file: File): Promise<Walk[]> => {
    return new Promise((resolve) => {
      const isFit = file.name.toLowerCase().endsWith('.fit') || file.name.toLowerCase().endsWith('.fit.gz');
      
      if (isFit) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          let bufferToParse: Buffer;
          
          if (file.name.toLowerCase().endsWith('.gz')) {
            try {
              const unzipped = pako.ungzip(new Uint8Array(arrayBuffer));
              bufferToParse = Buffer.from(unzipped);
            } catch {
              console.error("Failed to ungzip", file.name);
              return resolve([]);
            }
          } else {
            bufferToParse = Buffer.from(arrayBuffer);
          }

          const fitParser = new FitParser({
            force: true,
            speedUnit: 'km/h',
            lengthUnit: 'km',
            temperatureUnit: 'celcius',
            elapsedRecordField: true,
            mode: 'list',
          });

          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fitParser.parse(bufferToParse as any, (error: any, data: any) => {
              if (error || !data || !data.records || data.records.length === 0) {
                return resolve([]);
              }
              
              if (data.sessions && data.sessions.length > 0 && data.sessions[0].sport) {
                const sport = String(data.sessions[0].sport).toLowerCase();
                if (sport !== 'walking' && sport !== 'hiking' && sport !== '11' && sport !== '17') {
                  return resolve([]);
                }
              }

              const points: [number, number][] = [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data.records.forEach((r: any) => {
                if (r.position_lat != null && r.position_long != null) {
                  let lat = r.position_lat;
                  let lon = r.position_long;
                  if (Math.abs(lat) > 180) lat = lat * (180 / Math.pow(2, 31));
                  if (Math.abs(lon) > 180) lon = lon * (180 / Math.pow(2, 31));
                  points.push([lat, lon]);
                }
              });
              
              if (points.length === 0) return resolve([]);
              
              let distanceKm = 0;
              if (data.sessions && data.sessions.length > 0 && data.sessions[0].total_distance) {
                distanceKm = data.sessions[0].total_distance;
              } else if (data.records.length > 0 && data.records[data.records.length - 1].distance) {
                distanceKm = data.records[data.records.length - 1].distance;
              }

              const distanceMiles = distanceKm * 0.621371;
            let walkDate = new Date(file.lastModified).toISOString();
            if (data.sessions && data.sessions.length > 0 && data.sessions[0].start_time) {
              walkDate = new Date(data.sessions[0].start_time).toISOString();
            }

            const newWalk: Walk = {
              id: file.name,
              name: file.name,
              date: walkDate,
              points: points,
              distanceMiles: distanceMiles,
              steps: Math.round(distanceMiles * 2000),
            };
            resolve([newWalk]);
            });
          } catch (err) {
            console.error("FIT Parser crashed synchronously:", err);
            resolve([]);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const gpxContent = e.target?.result as string;
          const gpx = new GPXParser();
          gpx.parse(gpxContent);
          
          if (gpx.tracks && gpx.tracks.length > 0) {
            const validTracks = gpx.tracks.filter(track => {
              if (!track.type) return true;
              const type = track.type.toLowerCase();
              return type.includes('walk') || type.includes('hike');
            });

            const parsedWalks = validTracks.map((track, idx) => {
              const distanceMiles = track.distance.total * 0.000621371;
              let walkDate = new Date(file.lastModified).toISOString();
              if (track.points && track.points.length > 0 && track.points[0].time) {
                walkDate = new Date(track.points[0].time).toISOString();
              }
              return {
                id: file.name + (validTracks.length > 1 ? `-${idx}` : ''),
                name: track.name || file.name,
                date: walkDate,
                points: track.points.map((p: { lat: number; lon: number }) => [p.lat, p.lon] as [number, number]),
                distanceMiles: distanceMiles,
                steps: Math.round(distanceMiles * 2000),
              };
            });
            resolve(parsedWalks);
          } else {
            resolve([]);
          }
        };
        reader.readAsText(file);
      }
    });
  };

  const startProcessingFiles = async (files: FileList | File[]) => {
    setIsProcessing(true);
    const validFiles = Array.from(files).filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith('.gpx') || n.endsWith('.xml') || n.endsWith('.fit') || n.endsWith('.gz');
    });

    setProgress({ current: 0, total: validFiles.length });

    const parsedWalks: Walk[] = [];
    
    for (let i = 0; i < validFiles.length; i++) {
      const parsed = await parseFile(validFiles[i]);
      parsedWalks.push(...parsed);
      setProgress({ current: i + 1, total: validFiles.length });
      await new Promise(r => setTimeout(r, 2000)); // Heavy rate limit to allow GC
    }

    if (parsedWalks.length > 0) {
      setWalks(prev => {
        const merged = [...prev, ...parsedWalks];
        const uniqueWalksMap: Record<string, Walk> = {};
        merged.forEach(walk => { uniqueWalksMap[walk.id] = walk; });
        const finalWalks = Object.values(uniqueWalksMap);
        
        fetch('/api/walks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalWalks)
        }).catch(e => console.error("API error saving walks", e));
        
        return finalWalks;
      });
    }
    setIsProcessing(false);
  };

  const migrateToDatabase = async () => {
    try {
      const saved = await localforage.getItem('walk_data');
      if (saved && Array.isArray(saved) && saved.length > 0) {
        setIsProcessing(true);
        const response = await fetch('/api/walks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saved)
        });
        if (response.ok) {
          alert('Successfully migrated walks to Postgres!');
        } else {
          alert('Failed to migrate: ' + await response.text());
        }
      } else {
        alert('No local walks to migrate!');
      }
    } catch (e) {
      console.error(e);
      alert('Migration error');
    } finally {
      setIsProcessing(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      startProcessingFiles(e.dataTransfer.files);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => { setIsDragging(false); };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      startProcessingFiles(e.target.files);
    }
  };

  const clearData = () => {
    if(confirm("Are you sure you want to clear all logged walks?")) {
      setWalks([]);
      localforage.setItem('walk_data', []);
      setSelectedDateStr(null);
      setActiveWalkId(null);
    }
  };

  const totalMiles = walks.reduce((acc, walk) => acc + walk.distanceMiles, 0);
  const totalSteps = walks.reduce((acc, walk) => acc + walk.steps, 0);
  const selectedDateWalks = selectedDateStr 
    ? walks.filter(w => new Date(w.date).toDateString() === new Date(selectedDateStr).toDateString())
    : [];

  const handleGenerateWalk = () => {
    if (!stridingResult?.unwalkedGeoJSON) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = generateWalkUrl(stridingResult.unwalkedGeoJSON as any);
    if (url) {
      window.open(url, '_blank');
    } else {
      alert("No remaining streets found!");
    }
  };

  return (
    <div className="app-container">
      {isCalendarOpen && (
        <CalendarModal 
          walks={walks}
          onClose={() => setIsCalendarOpen(false)}
          onSelectDate={(dateStr) => {
            setSelectedDateStr(dateStr);
            setActiveWalkId(null);
          }}
        />
      )}
      <div className="sidebar">
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Walk Dashboard</h1>
            <p>Downtown Minneapolis</p>
          </div>
          {!selectedDateStr && walks.length > 0 && (
            <button onClick={() => setIsCalendarOpen(true)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px', color: '#ccc', cursor: 'pointer', transition: 'all 0.2s' }}>
              <CalendarIcon size={18} />
            </button>
          )}
        </div>

        {selectedDateStr ? (
          <div className="flex flex-col gap-4 mt-2 h-full">
            <button onClick={() => { setSelectedDateStr(null); setActiveWalkId(null); }} className="text-sm text-gray-400 hover:text-white flex items-center gap-2 mb-2 transition-colors w-fit">
              <ArrowLeft size={16} /> Back to Overview
            </button>
            <h2 className="text-white text-lg font-medium">{new Date(selectedDateStr).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            <div className="flex-1 overflow-y-auto pr-2 space-y-3 pb-8">
              {selectedDateWalks.map(walk => (
                <div key={walk.id} onClick={() => setActiveWalkId(walk.id)} className={`p-4 rounded-xl cursor-pointer border transition-all ${activeWalkId === walk.id ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[0_0_15px_rgba(34,211,238,0.1)]' : 'bg-[#1e2329] border-white/5 hover:bg-[#252a30]'}`}>
                  <div className="text-white font-medium mb-1 truncate" title={walk.name}>{walk.name}</div>
                  <div className="text-sm text-gray-400 flex items-center justify-between">
                    <span>{walk.distanceMiles.toFixed(2)} mi</span>
                    <span>{walk.steps.toLocaleString()} steps</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-3 flex justify-between items-center">
                    <span>{new Date(walk.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {activeWalkId === walk.id && <span className="text-cyan-400 text-[10px] uppercase font-bold tracking-widest">Active</span>}
                  </div>
                </div>
              ))}
              {selectedDateWalks.length === 0 && <div className="text-gray-500 text-center mt-10">No walks found for this date.</div>}
            </div>
          </div>
        ) : (
          <>
            <div className="metrics-grid">
              <div className="metric-card">
                <Footprints className="metric-icon" size={20} />
                <div className="metric-value">{totalMiles.toFixed(2)}</div>
                <div className="metric-label">Total Miles</div>
              </div>
              <div className="metric-card">
                <MapIcon className="metric-icon" size={20} />
                <div className="metric-value">{totalSteps.toLocaleString()}</div>
                <div className="metric-label">Total Steps</div>
              </div>
              <div className="metric-card" style={{ gridColumn: 'span 2' }}>
                <CalendarIcon className="metric-icon" size={20} />
                <div className="metric-value">{walks.length}</div>
                <div className="metric-label">Walks Logged</div>
              </div>
            </div>

            {stridingResult && (
              <div className="metric-card col-span-2 mt-2" style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="metric-label mb-2" style={{ fontSize: '0.75rem', letterSpacing: '0.05em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                  DOWNTOWN STRIDING PROGRESS
                </div>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <div className="metric-value" style={{ color: '#4ade80', fontSize: '1.25rem' }}>
                      {stridingResult.walkedMiles.toFixed(2)}
                    </div>
                    <div className="metric-label" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Miles Walked</div>
                  </div>
                  <div>
                    <div className="metric-value" style={{ color: '#f87171', fontSize: '1.25rem' }}>
                      {stridingResult.remainingMiles.toFixed(2)}
                    </div>
                    <div className="metric-label" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Miles Remaining</div>
                  </div>
                </div>
                
                <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div 
                    className="bg-green-400 h-1.5 rounded-full" 
                    style={{ width: `${(stridingResult.walkedMiles / stridingResult.totalMiles) * 100}%`, background: '#10b981', transition: 'width 0.5s ease' }}
                  ></div>
                </div>
                <div className="text-right text-[0.65rem] text-gray-400 mb-4" style={{ color: 'var(--text-secondary)', marginTop: '-8px' }}>
                  {((stridingResult.walkedMiles / stridingResult.totalMiles) * 100).toFixed(1)}% Complete
                </div>

                <button 
                  onClick={() => setViewRemaining(!viewRemaining)}
                  className="w-full py-2 rounded-lg font-medium text-sm transition-colors duration-200 mb-2"
                  style={{ 
                    backgroundColor: viewRemaining ? '#374151' : '#ef4444', 
                    color: 'white',
                    border: viewRemaining ? '1px solid #4b5563' : 'none',
                    borderRadius: '8px'
                  }}
                >
                  {viewRemaining ? 'View Heatmap' : 'View Remaining Streets'}
                </button>

                <button 
                  onClick={handleGenerateWalk}
                  className="w-full py-2 rounded-lg font-medium text-sm transition-colors duration-200 mb-2"
                  style={{ 
                    backgroundColor: 'transparent', 
                    color: '#60a5fa',
                    border: '1px solid #3b82f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    borderRadius: '8px'
                  }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '16px', height: '16px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Generate Next Walk (7 mi max)
                </button>

                <button 
                  onClick={migrateToDatabase}
                  className="w-full py-2 rounded-lg font-medium text-sm transition-colors duration-200"
                  style={{ 
                    backgroundColor: 'transparent', 
                    color: '#10b981',
                    border: '1px solid #10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    borderRadius: '8px'
                  }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ width: '16px', height: '16px' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Migrate Data to Postgres
                </button>
              </div>
            )}

            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '12px', opacity: viewRemaining ? 0.3 : 1, pointerEvents: viewRemaining ? 'none' : 'auto', transition: 'all 0.3s' }}>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Map Intensity by Color</span>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#10b981' }}>Green</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{opacities.green.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.5" max="10.0" step="0.1" value={opacities.green} onChange={(e) => setOpacities({...opacities, green: parseFloat(e.target.value)})} style={{ width: '100%', accentColor: '#10b981' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#eab308' }}>Yellow</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{opacities.yellow.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.5" max="10.0" step="0.1" value={opacities.yellow} onChange={(e) => setOpacities({...opacities, yellow: parseFloat(e.target.value)})} style={{ width: '100%', accentColor: '#eab308' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#f97316' }}>Orange</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{opacities.orange.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.5" max="10.0" step="0.1" value={opacities.orange} onChange={(e) => setOpacities({...opacities, orange: parseFloat(e.target.value)})} style={{ width: '100%', accentColor: '#f97316' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#ef4444' }}>Red</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{opacities.red.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.5" max="10.0" step="0.1" value={opacities.red} onChange={(e) => setOpacities({...opacities, red: parseFloat(e.target.value)})} style={{ width: '100%', accentColor: '#ef4444' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#a855f7' }}>Purple</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{opacities.purple.toFixed(1)}x</span>
                </div>
                <input type="range" min="0.5" max="10.0" step="0.1" value={opacities.purple} onChange={(e) => setOpacities({...opacities, purple: parseFloat(e.target.value)})} style={{ width: '100%', accentColor: '#a855f7' }} />
              </div>
            </div>

            <div className="upload-section">
              <h3>Upload GPX / FIT Data</h3>
              <div className={`upload-area ${isDragging ? 'is-dragover' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={() => document.getElementById('gpx-upload')?.click()} style={{ opacity: isProcessing ? 0.8 : 1, pointerEvents: isProcessing ? 'none' : 'auto' }}>
                <UploadCloud size={32} color={isDragging || isProcessing ? "var(--accent-color)" : "var(--text-secondary)"} />
                {isProcessing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <p style={{ fontWeight: 600, color: 'var(--accent-color)' }}>Processing Files...</p>
                    <div style={{ width: '100%', background: 'rgba(255,255,255,0.1)', height: '6px', borderRadius: '4px', overflow: 'hidden' }}><div style={{ width: `${(progress.current / progress.total) * 100}%`, background: 'var(--accent-color)', height: '100%', transition: 'width 0.2s ease' }} /></div>
                  </div>
                ) : (
                  <><p>Drag and drop files here<br/>or click to browse</p><button className="btn-upload" onClick={(e) => { e.stopPropagation(); document.getElementById('gpx-upload')?.click(); }}>Select Files</button></>
                )}
                <input type="file" id="gpx-upload" accept=".gpx,.xml,.fit,.gz" multiple onChange={handleInputChange} onClick={(e) => e.stopPropagation()} style={{ display: 'none' }} />
              </div>
              {walks.length > 0 && (
                <button onClick={clearData} style={{ marginTop: '12px', background: 'transparent', border: '1px solid rgba(255,100,100,0.3)', color: '#ef4444', padding: '8px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Trash2 size={16} /> Clear Data
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="map-container">
        <Map 
          walks={selectedDateStr && activeWalkId ? walks.filter(w => w.id === activeWalkId) : (selectedDateStr ? selectedDateWalks : walks)} 
          activeWalkId={activeWalkId} 
          opacities={opacities} 
          viewRemaining={viewRemaining}
          stridingResult={stridingResult}
        />
      </div>
    </div>
  );
}
