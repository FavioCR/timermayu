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
  // Tratar strings vacíos o "-" como 0
  const parseValue = (val) => {
    if (val === "" || val === "-" || val === null || val === undefined) return 0;
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  };
  const hc = clamp(Math.floor(parseValue(h)), 0, 99);
  const mc = clamp(Math.floor(parseValue(m)), 0, 59);
  const sc = clamp(Math.floor(parseValue(s)), 0, 59);
  return hc * 3600 + mc * 60 + sc;
}

export default function App() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [editH, setEditH] = useState("");
  const [editM, setEditM] = useState("");
  const [editS, setEditS] = useState("");
  const [savedSeconds, setSavedSeconds] = useState(0);
  const [orangeThreshold, setOrangeThreshold] = useState(0); // naranja cuando queden ≤ X seg (0 = desactivado)
  const [redThreshold, setRedThreshold] = useState(0);       // rojo cuando queden ≤ X seg (0 = desactivado)
  const [displayUnit, setDisplayUnit] = useState("seconds"); // "seconds" o "minutes"
  const [orangeUnit, setOrangeUnit] = useState("seconds"); // unidad para umbral naranja
  const [redUnit, setRedUnit] = useState("seconds"); // unidad para umbral rojo
  const [showHours, setShowHours] = useState(true);
  const [showMinutes, setShowMinutes] = useState(true);
  const [showSeconds, setShowSeconds] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const intervalRef = useRef(null);
  const wakeLockRef = useRef(null);
  const startTimeRef = useRef(null);
  const initialSecondsRef = useRef(0);

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
      setEditH(ch > 0 ? String(ch) : "");
      setEditM(cm > 0 ? String(cm) : "");
      setEditS(cs > 0 ? String(cs) : "");
    }
  }, [seconds, running]);

  // Ocultar mensaje de finalización después de 5 segundos
  useEffect(() => {
    if (showCompletionMessage) {
      const timer = setTimeout(() => {
        setShowCompletionMessage(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showCompletionMessage]);

  // Ocultar mensaje cuando se inicia un nuevo timer
  useEffect(() => {
    if (running) {
      setShowCompletionMessage(false);
    }
  }, [running]);

  // Solicitar permiso para notificaciones al cargar la página
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      // Solicitar permiso de forma silenciosa (el usuario puede aceptar cuando el timer termine)
      // No solicitamos inmediatamente para no ser intrusivos
    }
  }, []);

  // Wake Lock para evitar que la pantalla se apague en móviles
  useEffect(() => {
    const requestWakeLock = async () => {
      if (!running) {
        // Liberar wake lock si existe
        if (wakeLockRef.current) {
          try {
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
          } catch (err) {
            console.log("Error al liberar wake lock:", err);
          }
        }
        return;
      }

      // Solicitar wake lock solo si está corriendo
      if ("wakeLock" in navigator) {
        try {
          const wakeLock = await navigator.wakeLock.request("screen");
          wakeLockRef.current = wakeLock;
          
          // Manejar cuando el wake lock se libera automáticamente
          wakeLock.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        } catch (err) {
          // El wake lock puede fallar si el usuario lo desactiva o si hay restricciones
          console.log("No se pudo activar wake lock:", err);
        }
      }
    };

    requestWakeLock();

    // Manejar cuando la página pierde/recupera visibilidad
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        // Liberar wake lock cuando la página está oculta
        if (wakeLockRef.current) {
          try {
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
          } catch (err) {
            console.log("Error al liberar wake lock:", err);
          }
        }
      } else if (running) {
        // Reactivar wake lock cuando la página vuelve a ser visible y el timer está corriendo
        await requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Limpiar wake lock al desmontar o cuando running cambia
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch((err) => {
          console.log("Error al liberar wake lock:", err);
        });
        wakeLockRef.current = null;
      }
    };
  }, [running]);

  useEffect(() => {
    // Función para calcular el tiempo restante basado en timestamps
    const calculateRemainingTime = () => {
      if (!startTimeRef.current) return 0;
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const remaining = Math.max(0, initialSecondsRef.current - elapsed);
      return remaining;
    };

    // Función para actualizar el contador
    const updateTimer = () => {
      if (!running) return;
      
      const remaining = calculateRemainingTime();
      
      if (remaining <= 0) {
        setSeconds(0);
        setRunning(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        startTimeRef.current = null;
        // Mostrar mensaje de finalización solo si el timer estaba corriendo
        setShowCompletionMessage(true);
        
        // Notificación del navegador si está disponible
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("¡Timer completado!", {
            body: "El contador ha llegado a 0",
            icon: "/android-chrome-192x192.png",
            badge: "/android-chrome-192x192.png",
          });
        } else if ("Notification" in window && Notification.permission === "default") {
          Notification.requestPermission().then((permission) => {
            if (permission === "granted") {
              new Notification("¡Timer completado!", {
                body: "El contador ha llegado a 0",
                icon: "/android-chrome-192x192.png",
                badge: "/android-chrome-192x192.png",
              });
            }
          });
        }
        
        // Sonido de notificación (usando Web Audio API)
        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.value = 800;
          oscillator.type = "sine";
          
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        } catch (err) {
          console.log("No se pudo reproducir sonido:", err);
        }
        
        return;
      }
      
      setSeconds(remaining);
    };

    if (!running) {
      // Limpiar cuando se detiene o pausa
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Cuando se pausa, calcular y guardar el tiempo restante actual
      if (startTimeRef.current !== null) {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const remaining = Math.max(0, initialSecondsRef.current - elapsed);
        // Actualizar initialSecondsRef con el tiempo restante para poder reanudar
        initialSecondsRef.current = remaining;
        // Resetear startTimeRef para que cuando se reanude, se inicialice correctamente
        startTimeRef.current = null;
      }
      return;
    }

    // Inicializar cuando se inicia el timer (primera vez o después de pausar)
    if (startTimeRef.current === null) {
      // Usar el tiempo actual (seconds) como tiempo inicial
      initialSecondsRef.current = seconds;
      startTimeRef.current = Date.now();
    }

    // Actualizar inmediatamente
    updateTimer();

    // Actualizar cada segundo
    intervalRef.current = setInterval(() => {
      updateTimer();
    }, 1000);

    // Manejar cuando la página vuelve a estar visible
    const handleVisibilityChange = () => {
      if (!document.hidden && running) {
        // Recalcular el tiempo cuando la página vuelve a estar visible
        updateTimer();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Manejar cuando la ventana vuelve a tener foco
    const handleFocus = () => {
      if (running) {
        updateTimer();
      }
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [running]);

  const handleClear = () => {
    setEditH("");
    setEditM("");
    setEditS("");
    setSeconds(0);
    setSavedSeconds(0);
    setShowHours(true);
    setShowMinutes(true);
    setShowSeconds(true);
    // Resetear refs del timer
    startTimeRef.current = null;
    initialSecondsRef.current = 0;
    // Ocultar mensaje de finalización
    setShowCompletionMessage(false);
  };

  return (
    <div
      className="min-h-screen text-white flex flex-col items-center justify-center transition-colors duration-500 relative overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      <div className="w-full text-center px-2 pb-20">
        <h1 className="text-[1.5rem] md:text-[2rem] font-semibold mb-4 md:mb-6">Timer</h1>

        {/* Mensaje de finalización */}
        {showCompletionMessage && (
          <div className="fixed top-4 left-0 right-0 flex justify-center z-50 animate-bounce px-4">
            <div className="bg-white text-black px-6 py-4 rounded-xl shadow-2xl border-4 border-yellow-400 flex items-center gap-3 max-w-md">
              <svg
                className="w-8 h-8 text-yellow-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-xl font-bold">¡Timer completado!</p>
                <p className="text-sm text-gray-600">El contador ha llegado a 0</p>
              </div>
              <button
                onClick={() => setShowCompletionMessage(false)}
                className="ml-2 text-gray-500 hover:text-gray-700"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

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
              setEditH("");
              setEditM("");
              setEditS("");
              setShowHours(true);
              setShowMinutes(true);
              setShowSeconds(true);
              // Resetear refs del timer
              startTimeRef.current = null;
              initialSecondsRef.current = 0;
              // Ocultar mensaje de finalización
              setShowCompletionMessage(false);
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
                      setEditH("");
                      const next = hmsToSeconds("", editM, editS);
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
                placeholder="-"
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : e.target.value;
                  setEditH(val);
                  const next = hmsToSeconds(val, editM, editS);
                  setSeconds(next);
                  setSavedSeconds(next);
                }}
                onFocus={(e) => {
                  if (e.target.value === "" || e.target.value === "-") {
                    e.target.value = "";
                  }
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black placeholder:text-gray-400"
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
                      setEditM("");
                      const next = hmsToSeconds(editH, "", editS);
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
                placeholder="-"
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : e.target.value;
                  setEditM(val);
                  const next = hmsToSeconds(editH, val, editS);
                  setSeconds(next);
                  setSavedSeconds(next);
                }}
                onFocus={(e) => {
                  if (e.target.value === "" || e.target.value === "-") {
                    e.target.value = "";
                  }
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black placeholder:text-gray-400"
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
                      setEditS("");
                      const next = hmsToSeconds(editH, editM, "");
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
                placeholder="-"
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : e.target.value;
                  setEditS(val);
                  const next = hmsToSeconds(editH, editM, val);
                  setSeconds(next);
                  setSavedSeconds(next);
                }}
                onFocus={(e) => {
                  if (e.target.value === "" || e.target.value === "-") {
                    e.target.value = "";
                  }
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black placeholder:text-gray-400"
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
                step="1"
                value={orangeThreshold === 0 ? "" : (orangeUnit === "seconds" ? Math.round(orangeThreshold) : Math.round(orangeThreshold / 60))}
                placeholder="-"
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : e.target.value;
                  if (val === "") {
                    setOrangeThreshold(0);
                  } else {
                    const numVal = parseFloat(val) || 0;
                    if (orangeUnit === "seconds") {
                      // Solo enteros en segundos
                      setOrangeThreshold(Math.max(0, Math.round(numVal)));
                    } else {
                      // Solo enteros en minutos
                      setOrangeThreshold(Math.max(0, Math.round(numVal * 60)));
                    }
                  }
                }}
                onBlur={(e) => {
                  // Asegurar que siempre sea entero al perder el foco
                  if (e.target.value !== "" && e.target.value !== "-") {
                    const numVal = Math.round(parseFloat(e.target.value) || 0);
                    if (numVal !== parseFloat(e.target.value)) {
                      e.target.value = numVal.toString();
                      if (orangeUnit === "seconds") {
                        setOrangeThreshold(Math.max(0, numVal));
                      } else {
                        setOrangeThreshold(Math.max(0, numVal * 60));
                      }
                    }
                  }
                }}
                onFocus={(e) => {
                  if (e.target.value === "" || e.target.value === "-") {
                    e.target.value = "";
                  }
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black placeholder:text-gray-400"
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
                step="1"
                value={redThreshold === 0 ? "" : (redUnit === "seconds" ? Math.round(redThreshold) : Math.round(redThreshold / 60))}
                placeholder="-"
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : e.target.value;
                  if (val === "") {
                    setRedThreshold(0);
                  } else {
                    const numVal = parseFloat(val) || 0;
                    if (redUnit === "seconds") {
                      // Solo enteros en segundos
                      setRedThreshold(Math.max(0, Math.round(numVal)));
                    } else {
                      // Solo enteros en minutos
                      setRedThreshold(Math.max(0, Math.round(numVal * 60)));
                    }
                  }
                }}
                onBlur={(e) => {
                  // Asegurar que siempre sea entero al perder el foco
                  if (e.target.value !== "" && e.target.value !== "-") {
                    const numVal = Math.round(parseFloat(e.target.value) || 0);
                    if (numVal !== parseFloat(e.target.value)) {
                      e.target.value = numVal.toString();
                      if (redUnit === "seconds") {
                        setRedThreshold(Math.max(0, numVal));
                      } else {
                        setRedThreshold(Math.max(0, numVal * 60));
                      }
                    }
                  }
                }}
                onFocus={(e) => {
                  if (e.target.value === "" || e.target.value === "-") {
                    e.target.value = "";
                  }
                }}
                disabled={running}
                className="w-16 sm:w-20 bg-white/90 border-2 border-[#333] rounded-lg px-2 py-2 text-center text-lg font-bold disabled:opacity-60 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-black placeholder:text-gray-400"
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
