// 작업대 run 선택. 모든 패널(과 결과 표)이 같은 선택을 본다.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Selection = { selected: string[]; set(ids: string[]): void; toggle(id: string): void };

export const SelectionContext = createContext<Selection | null>(null);

/** value/onChange를 주면 바깥 상태를 쓰고(결과 표와 공유), 없으면 안에서 들고 있는다. */
export function SelectionProvider({ value, onChange, children }: {
  value?: string[]; onChange?: (ids: string[]) => void; children: ReactNode;
}) {
  const [inner, setInner] = useState<string[]>([]);
  const selected = value ?? inner;
  const change = onChange ?? setInner;
  const ctx = useMemo<Selection>(() => ({
    selected,
    set: ids => {
      const next = [...new Set(ids)];
      // 같은 선택이면 그대로 둔다: 옵션 갱신 뒤 다시 오는 brushselected가 렌더를 되풀이하지 않게
      if (next.length === selected.length && next.every(id => selected.includes(id))) return;
      change(next);
    },
    toggle: id => change(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]),
  }), [selected, change]);
  return <SelectionContext.Provider value={ctx}>{children}</SelectionContext.Provider>;
}

export function useSelection(): Selection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error('SelectionProvider 밖에서 useSelection을 썼습니다');
  return ctx;
}
