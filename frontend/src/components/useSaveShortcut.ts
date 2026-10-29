import { useEffect, useRef } from 'react';

/** Ctrl/Cmd+S로 저장 (브라우저의 "페이지 저장" 대화상자를 막는다). 반환값은 Monaco addCommand 등에서 호출할 저장 함수. */
export function useSaveShortcut(onSave: () => void, enabled: boolean): () => void {
  const ref = useRef({ onSave, enabled });
  ref.current = { onSave, enabled };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (ref.current.enabled) ref.current.onSave();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return () => { if (ref.current.enabled) ref.current.onSave(); };
}
