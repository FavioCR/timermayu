import { useEffect, useRef, useState } from "react";

export default function FlipDigit({ value }) {
  const [displayedValue, setDisplayedValue] = useState(value);
  const [isFlipping, setIsFlipping] = useState(false);
  const [doAnimate, setDoAnimate] = useState(false);
  const prevValueRef = useRef(value);

  useEffect(() => {
    if (value !== prevValueRef.current && !isFlipping) {
      setIsFlipping(true);
    }
  }, [value, isFlipping]);

  // Un frame después de mostrar outgoing/incoming, activar la animación
  useEffect(() => {
    if (!isFlipping) {
      setDoAnimate(false);
      return;
    }
    const id = requestAnimationFrame(() => setDoAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [isFlipping]);

  const handleTransitionEnd = (e) => {
    if (e.propertyName !== "transform" || !isFlipping) return;
    setDisplayedValue(value);
    prevValueRef.current = value;
    setIsFlipping(false);
  };

  if (!isFlipping) {
    return (
      <div className="flip-viewport">
        <div className="flip-current">{displayedValue}</div>
      </div>
    );
  }

  return (
    <div className={`flip-viewport ${doAnimate ? "flip-animate" : ""}`}>
      <div className="flip-outgoing">{displayedValue}</div>
      <div className="flip-incoming" onTransitionEnd={handleTransitionEnd}>
        {value}
      </div>
    </div>
  );
}
