import { useEffect, useRef, useState } from "react";
import "./App.css";
import FlipDigit from "./FlipDigit.jsx";

function secondsToHms(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return { h, m, s };
}

function hmsToSeconds(h, m, s) {
  const clamp = (n, min, max) => Math.min(max, Math.max(min, isNaN(n) ? 0 : n));
  const hc = clamp(Math.floor(Number(h) || 0), 0, 99);
  const mc = clamp(Math.floor(Number(m) || 0), 0, 59);
  const sc = clamp(Math.floor(Number(s) || 0), 0, 59);
  return hc * 3600 + mc * 60 + sc;
}

export default function App() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [editH, setEditH] = useState("0");
  const [editM, setEditM] = useState("0");
  const [editS, setEditS] = useState("0");
  const [savedSeconds, setSavedSeconds] = useState(0);
  const [orangeThreshold, setOrangeThreshold] = useState(360); // naranja cuando queden ≤ 360 seg
  const [redThreshold, setRedThreshold] = useState(180);       // rojo cuando queden ≤ 180 seg
  const [displayUnit, setDisplayUnit] = useState("seconds"); // "seconds" o "minutes"
  const [orangeUnit, setOrangeUnit] = useState("seconds"); // unidad para umbral naranja
  const [redUnit, setRedUnit] = useState("seconds"); // unidad para umbral rojo
  const [showHours, setShowHours] = useState(true);
  const [showMinutes, setShowMinutes] = useState(true);
  const [showSeconds, setShowSeconds] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const intervalRef = useRef(null);

  // Verde por defecto; naranja o rojo solo cuando está en marcha y se cumplen los umbrales
  const bgColor =
    !running
      ? "#78C841"
      : redThreshold > 0 && seconds <= redThreshold
        ? "#FB4141"
        : orangeThreshold > 0 && seconds <= orangeThreshold
          ? "#FF9B2F"
          : "#78C841";

  const { h, m, s } = secondsToHms(seconds);

  // Sincronizar inputs de edición cuando el timer está corriendo
  useEffect(() => {
    if (running) {
      const { h: ch, m: cm, s: cs } = secondsToHms(seconds);
      setEditH(String(ch));
      setEditM(String(cm));
      setEditS(String(cs));
    }
  }, [seconds, running]);

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [running]);

  const handleClear = () => {
    setEditH("0");
    setEditM("0");
    setEditS("0");
    setSeconds(0);
    setSavedSeconds(0);
    setShowHours(true);
    setShowMinutes(true);
    setShowSeconds(true);
  };

  return (
    <div
      className="min-h-screen text-white flex flex-col items-center justify-center transition-colors duration-500 relative overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      <div className="w-full text-center px-2 pb-20">
        <h1 className="text-[1.5rem] md:text-[2rem] font-semibold mb-4 md:mb-6">Timer</h1>

        {/* Flip clock: HH : MM : SS */}
        <div
          className="flex items-center justify-center gap-1 mb-6 font-medium text-[4.5rem] sm:text-[6rem] md:text-[10rem] xl:text-[16rem]"
        >
          {showHours && (
            <>
              <FlipDigit value={Math.floor(h / 10)} />
              <FlipDigit value={h % 10} />
              {(showMinutes || showSeconds) && (
                <span className="opacity-90 mx-0.5" style={{ fontFamily: "ui-monospace" }}>:</span>
              )}
            </>
          )}
          {showMinutes && (
            <>
              <FlipDigit value={Math.floor(m / 10)} />
              <FlipDigit value={m % 10} />
              {showSeconds && (
                <span className="opacity-90 mx-0.5" style={{ fontFamily: "ui-monospace" }}>:</span>
              )}
            </>
          )}
          {showSeconds && (
            <>
              <FlipDigit value={Math.floor(s / 10)} />
              <FlipDigit value={s % 10} />
            </>
          )}
        </div>

        {/* Botones de control */}
        <div className="w-full max-w-2xl mx-auto grid grid-cols-3 gap-3 md:gap-4 px-2">
          <button
            onClick={() => setRunning(true)}
            disabled={running || seconds === 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-3 md:px-8 md:py-4 rounded-xl text-lg md:text-xl font-semibold transition"
          >
            Start
          </button>
          <button
            onClick={() => setRunning(false)}
            disabled={!running}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 px-6 py-3 md:px-8 md:py-4 rounded-xl text-lg md:text-xl font-semibold transition"
          >
            Pause
          </button>
          <button
            onClick={() => {
              setRunning(false);
              setSeconds(0);
              setSavedSeconds(0);
              setEditH("0");
              setEditM("0");
              setEditS("0");
              setShowHours(true);
              setShowMinutes(true);
              setShowSeconds(true);
            }}
            className="bg-slate-800 hover:bg-slate-700 text-white px-6 py-3 md:px-8 md:py-4 rounded-xl text-lg md:text-xl font-semibold transition"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Botón toggle para abrir/cerrar controles */}
      <button
        onClick={() => setControlsOpen(!controlsOpen)}
        className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 px-6 py-3 md:px-8 md:py-4 rounded-full text-base md:text-lg font-semibold transition-all z-50 flex items-center gap-2 ${
          controlsOpen
            ? 'bg-black text-white hover:bg-gray-800'
            : 'bg-white/20 backdrop-blur-sm hover:bg-white/30 text-white'
        }`}
      >
        <svg
          className={`w-6 h-6 md:w-7 md:h-7 transition-transform duration-300 ${controlsOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
        Configuración
      </button>

      {/* Crédito del desarrollador */}
      <div className="fixed bottom-2 right-2 md:bottom-3 md:right-3 text-xs md:text-sm text-white/60 z-50">
        desarrollado por favio
      </div>

      {/* Panel deslizante con controles */}
      <div
        className={`fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md text-black transition-transform duration-500 ease-in-out z-40 ${
          controlsOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ maxHeight: '80vh', overflowY: 'auto' }}
      >
        <div className="p-6 pb-20">
          {/* Selector de unidad de tiempo y display */}
          <div className="flex items-center justify-center gap-4 mb-6 hidden">
            <select
              value={displayUnit}
              onChange={(e) => setDisplayUnit(e.target.value)}
              className="bg-white border-2 border-[#333] rounded-lg px-4 py-2 text-lg font-semibold text-black cursor-pointer"
            >
              <option value="seconds">Segundos</option>
              <option value="minutes">Minutos</option>
            </select>
            <div className="text-2xl md:text-3xl font-bold">
              {displayUnit === "seconds"
                ? `${seconds} segundos`
                : `${(seconds / 60).toFixed(2)} minutos`
              }
            </div>
          </div>

        {/* Edición del tiempo */}
        <div className="flex items-end justify-center gap-2 sm:gap-4 mb-6 flex-wrap">
          {showHours && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium mb-1">
                <input
                  type="checkbox"
                  checked={showHours}
                  onChange={(e) => {
                    setShowHours(e.target.checked);
                    if (!e.target.checked) {
                      setEditH("0");
                      const next = hmsToSeconds("0", editM, editS);
                      setSeconds(next);
                      setSavedSeconds(next);
                    }
                  }}
                  disabled={running}
                  className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                />
                Horas
              </label>
              <input
                type="number"
                min={0}
                max={99}
                value={editH}
                onChange={(e) => {
                  setEditH(e.target.value);
                  const next = hmsToSeconds(e.target.value, editM, editS);
                  setSeconds(next);
                  setSavedSeconds(next);
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black"
              />
            </div>
          )}
          {!showHours && (
            <button
              onClick={() => setShowHours(true)}
              disabled={running}
              className="bg-white/90 text-[#333] border-2 border-[#333] hover:bg-gray-100 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold disabled:cursor-not-allowed"
            >
              + Horas
            </button>
          )}
          {showMinutes && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium mb-1">
                <input
                  type="checkbox"
                  checked={showMinutes}
                  onChange={(e) => {
                    setShowMinutes(e.target.checked);
                    if (!e.target.checked) {
                      setEditM("0");
                      const next = hmsToSeconds(editH, "0", editS);
                      setSeconds(next);
                      setSavedSeconds(next);
                    }
                  }}
                  disabled={running}
                  className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                />
                Min
              </label>
              <input
                type="number"
                min={0}
                max={59}
                value={editM}
                onChange={(e) => {
                  setEditM(e.target.value);
                  const next = hmsToSeconds(editH, e.target.value, editS);
                  setSeconds(next);
                  setSavedSeconds(next);
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black"
              />
            </div>
          )}
          {!showMinutes && (
            <button
              onClick={() => setShowMinutes(true)}
              disabled={running}
              className="bg-white/90 text-[#333] border-2 border-[#333] hover:bg-gray-100 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold disabled:cursor-not-allowed"
            >
              + Min
            </button>
          )}
          {showSeconds && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium mb-1">
                <input
                  type="checkbox"
                  checked={showSeconds}
                  onChange={(e) => {
                    setShowSeconds(e.target.checked);
                    if (!e.target.checked) {
                      setEditS("0");
                      const next = hmsToSeconds(editH, editM, "0");
                      setSeconds(next);
                      setSavedSeconds(next);
                    }
                  }}
                  disabled={running}
                  className="w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                />
                Seg
              </label>
              <input
                type="number"
                min={0}
                max={59}
                value={editS}
                onChange={(e) => {
                  setEditS(e.target.value);
                  const next = hmsToSeconds(editH, editM, e.target.value);
                  setSeconds(next);
                  setSavedSeconds(next);
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black"
              />
            </div>
          )}
          {!showSeconds && (
            <button
              onClick={() => setShowSeconds(true)}
              disabled={running}
              className="bg-white/90 text-[#333] border-2 border-[#333] hover:bg-gray-100 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold disabled:cursor-not-allowed"
            >
              + Seg
            </button>
          )}
          <button
            onClick={handleClear}
            disabled={running}
            className="bg-white/90 text-[#333] border-2 border-[#333] hover:bg-gray-100 disabled:opacity-50 px-4 py-2 rounded-lg font-semibold disabled:cursor-not-allowed"
          >
            Limpiar
          </button>
        </div>

          {/* Cada color con su tiempo: verde por defecto, naranja y rojo con umbral en segundos */}
          <div className="flex flex-wrap items-start justify-center gap-4 sm:gap-6 mb-6 bg-white p-4 rounded-lg text-black w-fit mx-auto border-2 border-[#333]">
          <div className="flex items-center gap-2">
            <span
              className="w-8 h-8 rounded-lg border-2 border-white/50 shrink-0"
              style={{ backgroundColor: "#78C841" }}
              title="Verde"
            />
            <span className="text-sm font-medium">Verde: por defecto</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium mb-1">
              <span
                className="w-6 h-6 rounded border border-[#333] shrink-0"
                style={{ backgroundColor: "#FF9B2F" }}
              />
              Naranja cuando queden ≤
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={orangeUnit === "minutes" ? "0.1" : "1"}
                value={orangeUnit === "seconds" ? orangeThreshold : (orangeThreshold / 60).toFixed(1)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  const seconds = orangeUnit === "seconds" ? val : val * 60;
                  setOrangeThreshold(Math.max(0, Math.round(seconds)));
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black"
              />
              <select
                value={orangeUnit}
                onChange={(e) => setOrangeUnit(e.target.value)}
                disabled={running}
                className="bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-sm font-semibold text-black cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="seconds">seg</option>
                <option value="minutes">min</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <label className="flex items-center gap-2 text-sm font-medium mb-1">
              <span
                className="w-6 h-6 rounded border border-[#333] shrink-0"
                style={{ backgroundColor: "#FB4141" }}
              />
              Rojo cuando queden ≤
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                step={redUnit === "minutes" ? "0.1" : "1"}
                value={redUnit === "seconds" ? redThreshold : (redThreshold / 60).toFixed(1)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  const seconds = redUnit === "seconds" ? val : val * 60;
                  setRedThreshold(Math.max(0, Math.round(seconds)));
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black"
              />
              <select
                value={redUnit}
                onChange={(e) => setRedUnit(e.target.value)}
                disabled={running}
                className="bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-sm font-semibold text-black cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="seconds">seg</option>
                <option value="minutes">min</option>
              </select>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
