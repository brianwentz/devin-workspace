import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clampPaneWidth, SPLITTER_WIDTH, type Rect } from '../../core/layout';

interface SplitterProps {
  axis: 'x' | 'y';
  // The live splitter rect (from computeBounds); the pointer turns into a drag
  // session that reports positions to the main-process layout.
  rect: Rect;
  enabled: boolean;
}

// The position reported to main is the requested splitter coordinate — for the
// vertical pane splitter it's clamped like the end state (main converts the
// resulting pane width into the persisted fraction); for the terminal dock it's
// the raw pointer y (the dock splitter centers on it).
function currentPos(axis: 'x' | 'y', clientPos: number): number {
  if (axis === 'x') {
    const width = document.documentElement.clientWidth;
    return width - clampPaneWidth(width - clientPos - SPLITTER_WIDTH, width) - SPLITTER_WIDTH;
  }
  return clientPos;
}

export function Splitter({ axis, rect, enabled }: SplitterProps) {
  const dragging = useRef(false);
  const [guidePos, setGuidePos] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragging.current) {
        event.preventDefault();
        dragging.current = false;
        document.body.classList.remove('dragging');
        document.body.classList.remove('dragging-y');
        setGuidePos(null);
        window.devinworkspaces.dragCancel('escape');
      }
    };
    const offReset = window.devinworkspaces.onDragReset(() => {
      dragging.current = false;
      document.body.classList.remove('dragging');
      document.body.classList.remove('dragging-y');
      setGuidePos(null);
    });
    const offGuide = window.devinworkspaces.onDragGuide((guide) => {
      if (dragging.current && guide.axis === axis) setGuidePos(guide.pos);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      offReset();
      offGuide();
    };
  }, [axis]);

  const pointerPos = (event: PointerEvent) =>
    axis === 'x' ? event.clientX : event.clientY;

  return (
    <>
      <div
        id={axis === 'x' ? 'splitter' : 'terminalSplitter'}
        role="separator"
        aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        aria-label={axis === 'x' ? 'Resize GitHub pane' : 'Resize terminal dock'}
        className="shell-chrome absolute bg-[#2c3949] hover:bg-[#6e9bd0]"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          cursor: axis === 'x' ? 'col-resize' : 'row-resize',
          touchAction: 'none',
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !enabled) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
          document.body.classList.add(axis === 'x' ? 'dragging' : 'dragging-y');
          window.devinworkspaces.dragStart(axis, currentPos(axis, pointerPos(event)));
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const pos = currentPos(axis, pointerPos(event));
          setGuidePos(pos);
          window.devinworkspaces.dragMove(pos);
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          document.body.classList.remove('dragging');
          document.body.classList.remove('dragging-y');
          setGuidePos(null);
          window.devinworkspaces.dragEnd(currentPos(axis, pointerPos(event)));
        }}
        onPointerCancel={() => {
          if (!dragging.current) return;
          dragging.current = false;
          document.body.classList.remove('dragging');
          document.body.classList.remove('dragging-y');
          setGuidePos(null);
          window.devinworkspaces.dragCancel();
        }}
      />
      <div
        id="dragGuide"
        aria-hidden="true"
        className="absolute bg-[#91c4ff] pointer-events-none"
        style={{
          display: guidePos === null ? 'none' : 'block',
          ...(axis === 'x'
            ? { left: guidePos ?? rect.x, top: rect.y, width: 2, height: rect.height }
            : { left: rect.x, top: guidePos ?? rect.y, width: rect.width, height: 2 }),
        }}
      />
    </>
  );
}
