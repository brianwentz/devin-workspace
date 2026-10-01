import { useEffect, useState } from 'react';
import { computeBounds, RAIL_WIDTH } from '../core/layout';
import { useShellState } from './store';
import { Rail } from './components/Rail';
import { TabStrip } from './components/TabStrip';
import { NavBar } from './components/NavBar';
import { Splitter } from './components/Splitter';
import { SettingsPanel } from './components/SettingsPanel';
import { LocalPanel } from './local/LocalPanel';

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  }));
  useEffect(() => {
    const onResize = () =>
      setSize({
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export function App() {
  const state = useShellState();
  const size = useWindowSize();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      window.devinworkspaces.openLink(target.href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!state) return null;
  const bounds = computeBounds(size, { paneOpen: state.paneOpen, paneWidth: state.paneWidth });
  const paneVisible = state.paneOpen && !bounds.paneCollapsed;
  const mainRect = bounds.devin;

  return (
    <>
      <Rail
        surface={state.surface}
        paneOpen={state.paneOpen}
        paneCollapsed={bounds.paneCollapsed}
        credentialMatch={state.credentialMatch}
      />
      {paneVisible && bounds.tabStrip && bounds.navBar && (
        <>
          <TabStrip
            tabs={state.tabs.tabs}
            activeId={state.tabs.activeId}
            scope={state.tabs.scope}
            hiddenTabCount={state.tabs.hiddenTabCount}
            style={{
              position: 'absolute',
              left: bounds.tabStrip.x,
              top: bounds.tabStrip.y,
              width: bounds.tabStrip.width,
              height: bounds.tabStrip.height,
            }}
          />
          <NavBar
            active={state.tabs.tabs.find((tab) => tab.id === state.tabs.activeId) ?? null}
            style={{
              position: 'absolute',
              left: bounds.navBar.x,
              top: bounds.navBar.y,
              width: bounds.navBar.width,
              height: bounds.navBar.height,
            }}
          />
        </>
      )}
      {paneVisible && bounds.splitter && (
        <Splitter
          x={bounds.splitter.x}
          paneOpen={state.paneOpen}
        />
      )}
      {state.surface === 'settings' && (
        <SettingsPanel
          settings={state.settings}
          credentials={state.credentials}
          style={{
            position: 'absolute',
            left: Math.max(RAIL_WIDTH, mainRect.x),
            top: mainRect.y,
            width: mainRect.width,
            height: mainRect.height,
          }}
        />
      )}
      {state.surface === 'local' && (
        <LocalPanel
          style={{
            position: 'absolute',
            left: Math.max(RAIL_WIDTH, mainRect.x),
            top: mainRect.y,
            width: mainRect.width,
            height: mainRect.height,
          }}
        />
      )}
    </>
  );
}
