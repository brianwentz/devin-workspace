import { useEffect, useRef, useState } from 'react';
import { clampPaneWidth, SPLITTER_WIDTH } from '../../core/layout';

interface SplitterProps {
  x: number;
  paneOpen: boolean;
}

function currentX(clientX: number): number {
  const width = document.documentElement.clientWidth;
  const pane = clampPaneWidth(width - clientX - SPLITTER_WIDTH, width);
  return width - pane - SPLITTER_WIDTH;
}

export function Splitter({ x, paneOpen }: SplitterProps) {
  const dragging = useRef(false);
  const [guideX, setGuideX] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragging.current) {
        event.preventDefault();
        dragging.current = false;
        document.body.classList.remove('dragging');
        setGuideX(null);
        window.devinworkspaces.dragCancel('escape');
      }
    };
    const offReset = window.devinworkspaces.onDragReset(() => {
      dragging.current = false;
      document.body.classList.remove('dragging');
      setGuideX(null);
    });
    const offGuide = window.devinworkspaces.onDragGuide((gx) => {
      if (dragging.current) setGuideX(gx);
    });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      offReset();
      offGuide();
    };
  }, []);

  return (
    <>
      <div
        id="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize GitHub pane"
        className="shell-chrome absolute top-0 h-full bg-[#2c3949] hover:bg-[#6e9bd0]"
        style={{ left: x, width: SPLITTER_WIDTH, cursor: 'col-resize', touchAction: 'none' }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !paneOpen) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragging.current = true;
          document.body.classList.add('dragging');
          window.devinworkspaces.dragStart(currentX(event.clientX));
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const cx = currentX(event.clientX);
          setGuideX(cx);
          window.devinworkspaces.dragMove(cx);
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          document.body.classList.remove('dragging');
          setGuideX(null);
          window.devinworkspaces.dragEnd(currentX(event.clientX));
        }}
        onPointerCancel={() => {
          if (!dragging.current) return;
          dragging.current = false;
          document.body.classList.remove('dragging');
          setGuideX(null);
          window.devinworkspaces.dragCancel();
        }}
      />
      <div
        id="dragGuide"
        aria-hidden="true"
        className="absolute top-0 h-full bg-[#91c4ff] pointer-events-none"
        style={{ left: guideX ?? x, width: 2, display: guideX === null ? 'none' : 'block' }}
      />
    </>
  );
}
