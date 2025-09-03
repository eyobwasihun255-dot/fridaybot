const CountdownOverlay = ({ countdownEndAt }: { countdownEndAt: number }) => {
  const [remaining, setRemaining] = React.useState(
    Math.max(0, Math.floor((countdownEndAt - Date.now()) / 1000))
  );

  React.useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.floor((countdownEndAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdownEndAt]);

  if (remaining <= 0) return null;

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center rounded">
      <div className="bg-white text-black rounded-xl text-center shadow-xl mx-[10%] w-[80%]">
        <h2 className="text-xl font-bold mb-2">Game starting soon</h2>
        <p className="text-4xl font-mono">{remaining}s</p>
      </div>
    </div>
  );
};
