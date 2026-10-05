import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  clampPaneWidth,
  leftChrome,
  SPLITTER_WIDTH,
  type Rect,
} from '../../core/layout';
import { useShellState } from '../store';

interface SplitterProps {
  axis: 'x' | 'y' | 's';
  // The live splitter rect (from computeBounds); the pointer turns into a drag
  // session that reports positions to the main-process layout.
  rect: Rect;
  enabled: boolean;
}

// The position reported to main is the requested splitter coordinate — for the
// vertical pane splitter it's clamped like the end state (main converts the
// resulting pane width into the persisted fraction); for the sessions column
// and the terminal dock it's the raw pointer position.
function currentPos(
  axis: 'x' | 'y' | 's',
  clientPos: number,
  chrome = 0,
): number {
  if (axis === 'x') {
    const width = document.documentElement.clientWidth;
    return width - clampPaneWidth(width - clientPos - SPLITTER_WIDTH, width, chrome) - SPLITTER_WIDTH;
  }
  return clientPos;
}

export function Splitter({ axis, rect, enabled }: SplitterProps) {
  const dragging = useRef(false);
  const [guidePos, setGuidePos] = useState<number | null>(null);
  const state = useShellState();
  const chrome = state
    ? leftChrome(
        {
          paneOpen: state.paneOpen,
          paneFraction: state.paneFraction,
          terminalOpen: state.terminalOpen,
          terminalHeight: state.terminalHeight,
          sessionsOpen: state.sessionsOpen && state.surface === 'cloud',
          sessionsWidth: state.sessionsWidth,
        },
        document.documentElement.clientWidth,
      )
    : 0;

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
    axis === 'y' ? event.clientY : event.clientX;

  const id =
    axis === 'x' ? 'splitter' : axis === 's' ? 'sessionsSplitter' : 'terminalSplitter';
  const label =
    axis === 'x'
      ? 'Resize GitHub pane'
      : axis === 's'
        ? 'Resize sessions sidebar'
        : 'Resize terminal dock';

  return (
    <>
      <div
        id={id}
        role="separator"
        aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
        aria-label={label}
        className="shell-chrome absolute bg-[#2c3949] hover:bg-[#6e9bd0]"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          cursor: axis === 'y' ? 'row-resize' : 'col-resize',
          touchAction: 'none',
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !enabled) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
          document.body.classList.add(axis === 'y' ? 'dragging-y' : 'dragging');
          window.devinworkspaces.dragStart(axis, currentPos(axis, pointerPos(event), chrome));
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const pos = currentPos(axis, pointerPos(event), chrome);
          setGuidePos(pos);
          window.devinworkspaces.dragMove(pos);
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          document.body.classList.remove('dragging');
          document.body.classList.remove('dragging-y');
          setGuidePos(null);
          window.devinworkspaces.dragEnd(currentPos(axis, pointerPos(event), chrome));
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
        className={`absolute bg-[#91c4ff] pointer-events-none ${axis === 'y' ? 'left-0 w-full' : ''}`}
        style={{
          display: guidePos === null ? 'none' : 'block',
          ...(axis === 'y'
            ? { top: guidePos ?? rect.y, height: 2 }
            : { left: guidePos ?? rect.x, top: rect.y, width: 2, height: rect.height }),
        }}
      />
    </>
  );
}
