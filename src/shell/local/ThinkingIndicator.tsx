import { useEffect, useState } from 'react';
import { formatElapsed } from '../../core/format';

export function ThinkingIndicator({ startedAt }: { startedAt: string | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = startedAt ? formatElapsed(Date.now() - Date.parse(startedAt)) : null;
  return (
    <div id="thinking" className="flex items-center gap-2 text-xs text-[#7f8ca0]" aria-live="polite">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span>Thinking…{elapsed ? ` ${elapsed}` : ''}</span>
    </div>
  );
}
