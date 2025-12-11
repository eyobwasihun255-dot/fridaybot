import { useState, useEffect } from "react";

const CountdownOverlay = ({ endTime }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setTimeLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded">
      <div className="bg-white text-black p-4 rounded-xl shadow-xl text-center">
        <h2 className="font-bold mb-2">Time Left</h2>
        <p className="text-lg font-mono">{timeLeft}s</p>
      </div>
    </div>
  );
};

export default CountdownOverlay;
