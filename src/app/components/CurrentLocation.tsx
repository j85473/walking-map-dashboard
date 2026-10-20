"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Marker, Pane, useMap } from "react-leaflet";
import { DomEvent, divIcon } from "leaflet";
import { LocateFixed, X } from "lucide-react";

const locationIcon = divIcon({
  className: "current-location-marker",
  html: '<span class="current-location-dot" role="img" aria-label="Your current location"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

type Location = { latitude: number; longitude: number; accuracy: number };

export default function CurrentLocation({ onLocate }: { onLocate: () => void }) {
  const map = useMap();
  const [location, setLocation] = useState<Location | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "active" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);
  const trackingRequested = useRef(false);
  const centerOnNextFix = useRef(false);
  const controlRef = useRef<HTMLDivElement>(null);

  const clearWatch = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
  }, []);

  const startLocation = useCallback((recenter: boolean) => {
    if (!window.isSecureContext) {
      setStatus("error");
      setMessage("Location needs a secure connection. Open this dashboard using its HTTPS address, then tap My location.");
      return;
    }
    if (!navigator.geolocation) {
      setStatus("error");
      setMessage("This browser does not support location. Try Safari or Chrome with location services enabled.");
      return;
    }
    clearWatch();
    trackingRequested.current = true;
    centerOnNextFix.current = recenter;
    setStatus("loading");
    setMessage(null);
    watchRef.current = navigator.geolocation.watchPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      setLocation({ latitude, longitude, accuracy });
      setStatus("active");
      setMessage(null);
      // Keep the dot current without pulling the map away while exploring.
      if (centerOnNextFix.current) {
        map.setView([latitude, longitude], Math.max(map.getZoom(), 16));
        centerOnNextFix.current = false;
      }
    }, error => {
      setLocation(null);
      setStatus("error");
      if (error.code === 1) {
        clearWatch();
        trackingRequested.current = false;
        setMessage("Location access is off. Allow location for this site in your browser settings, then tap My location again.");
      } else {
        setMessage(error.code === 3
          ? "Getting your location is taking longer than expected. Waiting for a GPS signal; you can also tap My location to retry."
          : "Your location is unavailable. Check that location services are on, then tap My location to retry.");
      }
    }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
  }, [clearWatch, map]);

  useEffect(() => {
    let mounted = true;
    // Resume quietly when permission was already granted. First use is a tap.
    navigator.permissions?.query({ name: "geolocation" }).then(permission => {
      if (mounted && permission.state === "granted" && !document.hidden && !trackingRequested.current) startLocation(false);
    }).catch(() => { /* Safari versions without Permissions API still support the button. */ });
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearWatch();
        setLocation(null);
        setStatus("idle");
      } else if (trackingRequested.current) startLocation(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (controlRef.current) {
      DomEvent.disableClickPropagation(controlRef.current);
      DomEvent.disableScrollPropagation(controlRef.current);
    }
    return () => {
      mounted = false;
      clearWatch();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [clearWatch, startLocation]);

  return <>
    {location && <Pane name="current-location" style={{ zIndex: 650, pointerEvents: "none" }}>
      <Circle center={[location.latitude, location.longitude]} radius={location.accuracy} interactive={false} pathOptions={{ color: "#398aff", weight: 1, opacity: 0.4, fillColor: "#398aff", fillOpacity: 0.12 }} />
      <Marker position={[location.latitude, location.longitude]} icon={locationIcon} keyboard={false} interactive={false} />
    </Pane>}
    <div className="location-control" ref={controlRef}>
      <button className={`locate-button ${status}`} aria-label={status === "active" ? "Center map on my location" : "Show my location"} aria-busy={status === "loading"} onClick={() => {
        onLocate();
        if (location && status === "active") map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 16));
        else startLocation(true);
      }}><LocateFixed size={19} /><span>{status === "loading" ? "Locating…" : "My location"}</span></button>
      <span className="sr-only" role="status">{status === "active" ? "Showing your current location on the map." : status === "loading" ? "Finding your location." : ""}</span>
      {message && <div className="location-notice" role="status"><span>{message}</span><button aria-label="Dismiss location message" onClick={() => setMessage(null)}><X size={17} /></button></div>}
    </div>
  </>;
}
