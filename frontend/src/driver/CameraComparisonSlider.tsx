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
export const AUTO_SLIDER_MIN = 0.4;
export const AUTO_SLIDER_MAX = 0.6;
export const AUTO_SLIDER_HOLD_MS = 5000;
export const AUTO_SLIDER_TRAVEL_MS = 2600;
export const AUTO_SLIDER_CYCLE_MS =
  AUTO_SLIDER_HOLD_MS * 2 + AUTO_SLIDER_TRAVEL_MS * 2;

function easeInOut(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

export function autoSliderPosition(elapsedMs: number): number {
  const elapsed = ((elapsedMs % AUTO_SLIDER_CYCLE_MS) + AUTO_SLIDER_CYCLE_MS) % AUTO_SLIDER_CYCLE_MS;
  const rightTravelStart = AUTO_SLIDER_HOLD_MS;
  const rightHoldStart = rightTravelStart + AUTO_SLIDER_TRAVEL_MS;
  const leftTravelStart = rightHoldStart + AUTO_SLIDER_HOLD_MS;

  if (elapsed < rightTravelStart) return AUTO_SLIDER_MIN;
  if (elapsed < rightHoldStart) {
    const progress = (elapsed - rightTravelStart) / AUTO_SLIDER_TRAVEL_MS;
    return AUTO_SLIDER_MIN + (AUTO_SLIDER_MAX - AUTO_SLIDER_MIN) * easeInOut(progress);
  }
  if (elapsed < leftTravelStart) return AUTO_SLIDER_MAX;

  const progress = (elapsed - leftTravelStart) / AUTO_SLIDER_TRAVEL_MS;
  return AUTO_SLIDER_MAX - (AUTO_SLIDER_MAX - AUTO_SLIDER_MIN) * easeInOut(progress);
}

export function CameraComparisonSlider({
  opticalSrc = OPTICAL_DEFAULT,
  irSrc = IR_DEFAULT,
  className = "",
}: CameraComparisonSliderProps) {
  const [sliderPos, setSliderPos] = useState(AUTO_SLIDER_MIN);
  const [isAutoScanning, setIsAutoScanning] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoAnimRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isAutoScanning || isDragging) {
      if (autoAnimRef.current !== null) {
        cancelAnimationFrame(autoAnimRef.current);
        autoAnimRef.current = null;
      }
      return;
    }

    startTimeRef.current = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current;
      setSliderPos(autoSliderPosition(elapsed));
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

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, []);

  const scheduleAutoResume = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      startTimeRef.current = Date.now();
      setSliderPos(AUTO_SLIDER_MIN);
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
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      setIsAutoScanning(false);
      setSliderPos((pos) => Math.max(0.02, pos - 0.05));
      scheduleAutoResume();
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      setIsAutoScanning(false);
      setSliderPos((pos) => Math.min(0.98, pos + 0.05));
      scheduleAutoResume();
      e.preventDefault();
    } else if (e.key === "Home") {
      setIsAutoScanning(false);
      setSliderPos(0.02);
      scheduleAutoResume();
      e.preventDefault();
    } else if (e.key === "End") {
      setIsAutoScanning(false);
      setSliderPos(0.98);
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
        style={{ clipPath: `inset(0 ${(1 - sliderPos) * 100}% 0 0)` }}
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
