import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface CameraComparisonSliderProps {
  opticalSrc?: string;
  irSrc?: string;
  className?: string;
}

const OPTICAL_DEFAULT = "/camera/haul_truck_optical.png";
const IR_DEFAULT = "/camera/haul_truck_ir.png";

export function CameraComparisonSlider({
  opticalSrc = OPTICAL_DEFAULT,
  irSrc = IR_DEFAULT,
  className = "",
}: CameraComparisonSliderProps) {
  const [sliderPos, setSliderPos] = useState(0.5); // 0.0 to 1.0 (50% default)
  const [isAutoScanning, setIsAutoScanning] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoAnimRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const pauseTimeOffsetRef = useRef<number>(0);

  // Auto-scan sinusoidal animation: sweeps smoothly between 15% and 85%
  useEffect(() => {
    if (!isAutoScanning || isDragging) {
      if (autoAnimRef.current !== null) {
        cancelAnimationFrame(autoAnimRef.current);
        autoAnimRef.current = null;
      }
      return;
    }

    const PERIOD_MS = 6000; // 6 second full back-and-forth cycle
    startTimeRef.current = Date.now() - pauseTimeOffsetRef.current;

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      pauseTimeOffsetRef.current = elapsed % PERIOD_MS;
      // Sine wave oscillates between -1 and 1 -> mapped to 0.15 to 0.85
      const phase = (elapsed / PERIOD_MS) * Math.PI * 2;
      const normalized = (Math.sin(phase) + 1) / 2; // 0 to 1
      const smoothPos = 0.15 + normalized * 0.7; // 15% to 85%
      setSliderPos(smoothPos);
      autoAnimRef.current = requestAnimationFrame(animate);
    };

    autoAnimRef.current = requestAnimationFrame(animate);

    return () => {
      if (autoAnimRef.current !== null) {
        cancelAnimationFrame(autoAnimRef.current);
        autoAnimRef.current = null;
      }
    };
  }, [isAutoScanning, isDragging]);

  const scheduleAutoResume = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      startTimeRef.current = Date.now();
      pauseTimeOffsetRef.current = 0;
      setIsAutoScanning(true);
    }, 2800);
  }, []);

  const updateSliderFromPointer = useCallback(
    (clientX: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const relativeX = clientX - rect.left;
      const clamped = Math.max(0.02, Math.min(0.98, relativeX / rect.width));
      setSliderPos(clamped);
    },
    [],
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    setIsAutoScanning(false);
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updateSliderFromPointer(e.clientX);
    e.preventDefault();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateSliderFromPointer(e.clientX);
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may have been released
      }
      scheduleAutoResume();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      setIsAutoScanning(false);
      setSliderPos((pos) => Math.max(0.02, pos - 0.05));
      scheduleAutoResume();
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setIsAutoScanning(false);
      setSliderPos((pos) => Math.min(0.98, pos + 0.05));
      scheduleAutoResume();
      e.preventDefault();
    }
  };

  const splitPercent = Math.round(sliderPos * 100);

  return (
    <div
      ref={containerRef}
      className={`camera-comparison-container ${className} ${isDragging ? "is-dragging" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Optical vs Infrared camera comparison slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={splitPercent}
      aria-valuetext={`${splitPercent}% visible optical, ${100 - splitPercent}% thermal IR`}
    >
      {/* Base Layer: Thermal IR Camera View */}
      <div className="slider-layer slider-layer-ir" aria-hidden="true">
        <img
          src={irSrc}
          alt="Thermal IR camera penetrating dense mining fog"
          className="comparison-img comparison-img-ir"
          draggable={false}
        />
        <div className="slider-tag slider-tag-ir">
          <i className="tag-ir-icon" aria-hidden="true" />
          <span>THERMAL IR CAMERA</span>
        </div>
      </div>

      {/* Top Layer: Optical Real Life View (Clipped by slider) */}
      <div
        className="slider-layer slider-layer-optical"
        style={{ clipPath: `inset(0 calc(${100 - splitPercent}%) 0 0)` }}
        aria-hidden="true"
      >
        <img
          src={opticalSrc}
          alt="Real life optical view in dense mining fog"
          className="comparison-img comparison-img-optical"
          draggable={false}
        />
        <div className="slider-tag slider-tag-optical">
          <i className="tag-optical-icon" aria-hidden="true" />
          <span>REAL LIFE VIEW (OPTICAL FOG)</span>
        </div>
      </div>

      {/* Vertical Slider Divider Line */}
      <div
        className="slider-divider-line"
        style={{ left: `${sliderPos * 100}%` }}
        aria-hidden="true"
      >
        <div className="slider-divider-glow" />
        <div className="slider-handle">
          <span className="handle-arrow">◀</span>
          <span className="handle-grip" />
          <span className="handle-arrow">▶</span>
        </div>
      </div>
    </div>
  );
}
