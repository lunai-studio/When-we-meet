import type { ReactNode } from 'react';
import type { Profile } from './types';
import { initials } from './logic';

export function Avatar({ p, sm }: { p: Pick<Profile, 'display_name' | 'color'>; sm?: boolean }) {
  return (
    <span className={'avatar' + (sm ? ' sm' : '')} style={{ background: p.color }} title={p.display_name}>
      {initials(p.display_name)}
    </span>
  );
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" />
        {children}
      </div>
    </div>
  );
}

export function Toast({ msg, onUndo, undoLabel }: { msg: string; onUndo?: () => void; undoLabel: string }) {
  return (
    <div className="toast" role="status">
      <span>{msg}</span>
      {onUndo && <button onClick={onUndo}>{undoLabel}</button>}
    </div>
  );
}
